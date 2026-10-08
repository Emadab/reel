"""IMDb, Rotten Tomatoes and Metacritic scores: from OMDb when a key is set, otherwise from IMDb's ratings dataset
and Wikidata. Filled for the whole library in the background, and for any other film when its page opens."""
import asyncio
import gzip
import re
import time

import httpx
from sqlmodel import Session, or_, select

from . import db, jobs
from .config import settings
from .models import Movie, Watch, WatchlistItem, now
from .tmdb import STALE, utc

client = httpx.AsyncClient(timeout=10)


async def refresh_scores(s: Session, m: Movie, force: bool = False) -> None:
    if not settings.omdb_key or not m.imdb_id:
        return
    if not force and m.omdb_fetched_at and now() - utc(m.omdb_fetched_at) < STALE:
        return
    try:
        r = await client.get("https://www.omdbapi.com/", params={"i": m.imdb_id, "apikey": settings.omdb_key})
        d = r.json()
    except (httpx.HTTPError, ValueError):
        return
    if d.get("Response") != "True":
        return
    m.omdb = _parse(d)
    m.omdb_fetched_at = now()
    s.add(m)
    s.commit()


def _parse(d: dict) -> dict:
    na = lambda v: None if not v or v == "N/A" else v  # noqa: E731
    rt = next((x["Value"] for x in d.get("Ratings", []) if x.get("Source") == "Rotten Tomatoes"), None)
    return {"imdb": na(d.get("imdbRating")), "rt": na(rt), "metacritic": na(d.get("Metascore")),
            "imdb_votes": na(d.get("imdbVotes")), "awards": na(d.get("Awards")), "box_office": na(d.get("BoxOffice"))}


async def scores_for(imdb_id: str) -> dict:
    """Scores for any IMDb title (series too), from the same sources as films. Raises when offline."""
    if settings.omdb_key:
        d = (await client.get("https://www.omdbapi.com/", params={"i": imdb_id, "apikey": settings.omdb_key})).json()
        return _parse(d) if d.get("Response") == "True" else {}
    imdb = await imdb_ratings({imdb_id})
    return _keyless(imdb.get(imdb_id)) | (await wikidata_scores([imdb_id])).get(imdb_id, {})


def _keyless(imdb: tuple[str, str] | None) -> dict:
    rating, votes = imdb or (None, None)
    return {"imdb": rating, "imdb_votes": votes, "rt": None, "metacritic": None}


async def check_key(key: str) -> bool:
    try:
        r = await client.get("https://www.omdbapi.com/", params={"i": "tt0111161", "apikey": key})
        return r.status_code == 200 and r.json().get("Response") == "True"
    except (httpx.HTTPError, ValueError):
        return False


# Without an OMDb key: IMDb's own ratings dataset, and Rotten Tomatoes / Metacritic as recorded on Wikidata.
IMDB_DATASET = "https://datasets.imdbws.com/title.ratings.tsv.gz"
WIKIDATA = "https://query.wikidata.org/sparql"
RT, METACRITIC = "http://www.wikidata.org/entity/Q105584", "http://www.wikidata.org/entity/Q150248"
TOMATOMETER, METASCORE = "http://www.wikidata.org/entity/Q108403393", "http://www.wikidata.org/entity/Q106515043"
open_client = httpx.AsyncClient(timeout=60, headers={"User-Agent": "Reel/1.0 (personal film diary; local app)"}, follow_redirects=True)


async def imdb_ratings(ids: set[str]) -> dict[str, tuple[str, str]]:
    """IMDb (rating, vote count) per title from IMDb's free dataset (≈9 MB, refreshed weekly on disk)."""
    path = settings.data_dir / "imdb-ratings.tsv.gz"
    if not path.exists() or time.time() - path.stat().st_mtime > 7 * 86400:
        tmp = path.with_suffix(".part")
        async with open_client.stream("GET", IMDB_DATASET) as r:
            r.raise_for_status()
            with tmp.open("wb") as f:
                async for chunk in r.aiter_bytes():
                    f.write(chunk)
        tmp.replace(path)

    def scan() -> dict[str, tuple[str, str]]:
        out = {}
        with gzip.open(path, "rt", encoding="utf-8") as f:
            for line in f:
                tid, rating, votes = line.rstrip("\n").split("\t")
                if tid in ids:
                    out[tid] = (rating, votes)
        return out

    return await asyncio.to_thread(scan)  # 1.5 M lines: keep the event loop free


async def wikidata_scores(ids: list[str]) -> dict[str, dict]:
    """The latest Tomatometer (%) and Metascore (/100) per IMDb id."""
    best: dict[tuple[str, str], tuple[str, str]] = {}
    for k in range(0, len(ids), 150):
        values = " ".join(f'"{i}"' for i in ids[k:k + 150] if re.fullmatch(r"tt\d+", i))
        q = f"""SELECT ?imdb ?score ?by ?when ?method WHERE {{ VALUES ?imdb {{{values}}} ?f wdt:P345 ?imdb; p:P444 ?st.
            ?st ps:P444 ?score; pq:P447 ?by. OPTIONAL {{?st pq:P585 ?when}} OPTIONAL {{?st pq:P459 ?method}}
            FILTER(?by IN (wd:Q105584, wd:Q150248)) }}"""
        r = await open_client.get(WIKIDATA, params={"query": q}, headers={"Accept": "application/sparql-results+json"})
        r.raise_for_status()
        for b in r.json()["results"]["bindings"]:
            v = lambda n: b.get(n, {}).get("value", "")  # noqa: E731
            score, by, method = v("score").strip(), v("by"), v("method")
            if by == RT and score.endswith("%") and method in ("", TOMATOMETER):
                key, val = "rt", score
            elif by == METACRITIC and (m := re.fullmatch(r"(\d+)\s*/\s*100", score)) and method in ("", METASCORE):
                key, val = "metacritic", m.group(1)
            else:
                continue
            if (old := best.get((v("imdb"), key))) is None or v("when") > old[1]:
                best[(v("imdb"), key)] = (val, v("when"))
    out: dict[str, dict] = {}
    for (imdb, key), (val, _) in best.items():
        out.setdefault(imdb, {})[key] = val
    return out


async def fill_scores(ids: list[int] | None = None, force: bool = False) -> None:
    """Scores for the given films, or every watched/watchlisted film that has none. OMDb when a key is set, otherwise
    the keyless sources in one batch."""
    with Session(db.engine) as s:
        q = select(Movie).where(Movie.imdb_id.is_not(None))
        if ids is not None:
            q = q.where(Movie.tmdb_id.in_(ids))
        else:
            q = q.where(or_(Movie.tmdb_id.in_(select(Watch.tmdb_id)), Movie.tmdb_id.in_(select(WatchlistItem.tmdb_id))))
        films = list(s.exec(q))
        if not force:  # missing, a month old, or from before vote counts were kept
            films = [m for m in films if not m.omdb_fetched_at or now() - utc(m.omdb_fetched_at) >= STALE
                     or "imdb_votes" not in (m.omdb or {})]
        if not films:
            return
        if settings.omdb_key:
            for i, m in enumerate(films):
                await refresh_scores(s, m, force=force)
                jobs.progress("scores:library", i + 1, len(films))
            return
        try:
            imdb = await imdb_ratings({m.imdb_id for m in films})
            wd = await wikidata_scores([m.imdb_id for m in films])
        except (httpx.HTTPError, OSError, ValueError, KeyError):
            return  # offline: try again next start
        for m in films:
            m.omdb = _keyless(imdb.get(m.imdb_id)) | wd.get(m.imdb_id, {})
            m.omdb_fetched_at = now()
            s.add(m)
        s.commit()


async def fill_library() -> None:
    await fill_scores(force=True)
