"""TMDB client: bearer auth, 8 concurrent requests, retry on 429/5xx, and the 30-day movie cache."""
import asyncio
import time
from datetime import date, datetime, timedelta

import httpx
from fastapi import HTTPException
from sqlmodel import Session

from . import jobs, media, net
from .config import settings
from .models import Movie, now

STALE = timedelta(days=30)
api = httpx.AsyncClient(base_url="https://api.themoviedb.org/3", timeout=net.TIMEOUT)
_sem = asyncio.Semaphore(8)
_search_cache: dict[str, tuple[float, list[dict]]] = {}
DETAILS = "credits,keywords,videos,release_dates,external_ids"


class TMDBUnavailable(HTTPException):
    def __init__(self, detail: str):
        super().__init__(503, detail)


async def get(path: str, **params) -> dict:
    if not settings.tmdb_token:
        raise TMDBUnavailable("TMDB token missing. Add it in Settings.")
    if net.offline():
        raise TMDBUnavailable("You're offline. Cached films still work.")
    headers = {"Authorization": f"Bearer {settings.tmdb_token}"}
    for attempt in range(4):
        try:
            async with _sem:
                r = await api.get(path, params=params, headers=headers)
        except httpx.TransportError:
            if attempt >= 1:  # one quick retry, then fail fast and remember we're offline
                net.mark_offline()
                raise TMDBUnavailable("You're offline. Cached films still work.")
            await asyncio.sleep(0.3)
            continue
        net.mark_online()
        if r.status_code == 429 or r.status_code >= 500:
            await asyncio.sleep(float(r.headers.get("retry-after", 0.5 * 2**attempt)))
            continue
        if r.status_code == 401:
            raise TMDBUnavailable("TMDB rejected the token. Check it in Settings.")
        if r.status_code == 404:
            raise HTTPException(404, "Not found on TMDB")
        r.raise_for_status()
        return r.json()
    raise TMDBUnavailable("TMDB is rate limiting or down. Try again shortly.")


async def search(q: str) -> list[dict]:
    """Raw TMDB results, cached in memory for 10 minutes per query."""
    key = q.strip().lower()
    hit = _search_cache.get(key)
    if hit and time.monotonic() - hit[0] < 600:
        return hit[1]
    data = await get("/search/movie", query=q, include_adult="false", page=1)
    _search_cache[key] = (time.monotonic(), data["results"])
    return data["results"]


def _year(d: str | None) -> int | None:
    return int(d[:4]) if d else None


def _certification(d: dict) -> str | None:
    """The theatrical age rating: the US one when there is one, else the film's home country's."""
    by_country = {r.get("iso_3166_1"): r.get("release_dates", []) for r in d.get("release_dates", {}).get("results", [])}
    for c in ["US", *d.get("origin_country", [])]:
        dates = sorted(by_country.get(c, []), key=lambda x: x.get("type") != 3)  # 3 = theatrical first
        if cert := next((x["certification"].strip() for x in dates if (x.get("certification") or "").strip()), None):
            return cert
    return None


def _extra(d: dict) -> dict:
    col = d.get("belongs_to_collection")
    return {
        "certification": _certification(d),
        "budget": d.get("budget") or None,
        "revenue": d.get("revenue") or None,
        "countries": [c["name"] for c in d.get("production_countries", [])],
        "languages": [x.get("english_name") or x.get("name") for x in d.get("spoken_languages", [])],
        "studios": [c["name"] for c in d.get("production_companies", [])][:3],
        "status": d.get("status"),
        "homepage": d.get("homepage") or None,
        "collection": {"id": col["id"], "name": col["name"]} if col else None,
    }


async def add_collection_parts(m: Movie) -> None:
    """The other films in its series (one extra request, only for films in a collection)."""
    col = (m.extra or {}).get("collection")
    if not col or "parts" in col:
        return
    try:
        c = await get(f"/collection/{col['id']}")
    except (TMDBUnavailable, HTTPException):
        return
    parts = sorted(c.get("parts", []), key=lambda p: p.get("release_date") or "9999")
    m.extra = {**m.extra, "collection": {**col, "parts": [
        {"id": p["id"], "title": p.get("title"), "year": _year(p.get("release_date")), "poster_path": p.get("poster_path")}
        for p in parts]}}


def needs_extra(m: Movie) -> bool:
    """Films cached before these fields existed, or whose series hasn't been looked up yet."""
    col = (m.extra or {}).get("collection")
    return m.extra is None or bool(col and "parts" not in col)


async def extra_job(tmdb_id: int) -> None:
    """Backfill details for an already-cached film without touching its images."""
    from . import db  # late import: db imports models only

    with Session(db.engine) as s:
        m = s.get(Movie, tmdb_id)
        if not m:
            return
        if m.extra is None:
            try:
                d = await get(f"/movie/{tmdb_id}", append_to_response=DETAILS)
            except (TMDBUnavailable, HTTPException):
                return
            fields = parse_details(d)
            fields.pop("poster_path"), fields.pop("backdrop_path")
            m.sqlmodel_update(fields)
        await add_collection_parts(m)
        s.add(m)
        s.commit()


def parse_details(d: dict) -> dict:
    crew = d.get("credits", {}).get("crew", [])

    def jobs(*names: str) -> list[str]:
        out: list[str] = []
        for c in crew:
            if c.get("job") in names and c["name"] not in out:
                out.append(c["name"])
        return out

    directors = [{"id": c["id"], "name": c["name"]} for c in crew if c.get("job") == "Director"]
    videos = [v for v in d.get("videos", {}).get("results", []) if v.get("site") == "YouTube"]
    videos.sort(key=lambda v: (v.get("type") == "Trailer", bool(v.get("official")), v.get("published_at") or ""), reverse=True)
    rd = d.get("release_date") or None
    return dict(
        imdb_id=d.get("external_ids", {}).get("imdb_id") or d.get("imdb_id"),
        title=d["title"],
        original_title=d.get("original_title"),
        year=_year(rd),
        release_date=date.fromisoformat(rd) if rd else None,
        runtime=d.get("runtime") or None,
        overview=d.get("overview") or None,
        tagline=d.get("tagline") or None,
        genres=[g["name"] for g in d.get("genres", [])],
        director=", ".join(x["name"] for x in directors) or None,
        directors=directors,
        crew_highlights={
            "cinematography": jobs("Director of Photography"),
            "music": jobs("Original Music Composer", "Music"),
            "writer": jobs("Screenplay", "Writer"),
            "editing": jobs("Editor"),
            "producer": jobs("Producer")[:3],
        },
        extra=_extra(d),
        cast=[
            {"id": c["id"], "name": c["name"], "character": c.get("character"), "order": c.get("order", i),
             "profile_path": c.get("profile_path")}
            for i, c in enumerate(d.get("credits", {}).get("cast", [])[:20])
        ],
        keywords=[k["name"] for k in d.get("keywords", {}).get("keywords", [])],
        keyword_ids=[k["id"] for k in d.get("keywords", {}).get("keywords", [])],
        genre_ids=[g["id"] for g in d.get("genres", [])],
        language=d.get("original_language"),
        poster_path=d.get("poster_path"),
        backdrop_path=d.get("backdrop_path"),
        trailer_key=videos[0]["key"] if videos else None,
        tmdb_rating=d.get("vote_average"),
        tmdb_votes=d.get("vote_count"),
        popularity=d.get("popularity"),
    )


async def ensure_images(m: Movie, level: str = "full") -> bool:
    """Download whatever is missing for this level ("full": poster, thumb, backdrop; "wall": no backdrop;
    "light": thumb only),
    then compute the palette. Returns True if the row changed. Missing images are not fatal."""
    kinds = {"full": ("poster", "poster_sm", "backdrop"), "wall": ("poster", "poster_sm"), "light": ("poster_sm",)}.get(level, ())
    paths = {"poster": m.poster_path, "poster_sm": m.poster_path, "backdrop": m.backdrop_path}
    try:
        await asyncio.gather(*(media.download(k, m.tmdb_id, paths[k]) for k in kinds))
    except httpx.HTTPError:
        pass
    small = media.media_file("poster_sm", m.tmdb_id)
    if small.exists() and not m.palette:
        m.palette, m.dominant = await asyncio.to_thread(media.extract_palette, small)
        return True
    return False


def is_fresh(m: Movie | None) -> bool:
    if not m:
        return False
    fetched = m.fetched_at if m.fetched_at.tzinfo else m.fetched_at.replace(tzinfo=now().tzinfo)
    return now() - fetched < STALE


async def get_movie(s: Session, tmdb_id: int, force: bool = False, images: str = "full") -> Movie:
    """The cached movie; fetched from TMDB when missing, older than 30 days, or forced.
    A stale copy is returned as-is when TMDB is unreachable."""
    m = s.get(Movie, tmdb_id)
    if not (m and not force and is_fresh(m)):
        try:
            d = await get(f"/movie/{tmdb_id}", append_to_response=DETAILS)
        except TMDBUnavailable:
            if not m:
                raise
            d = None
        if d is not None:
            fields = parse_details(d)
            if m:
                if force or fields["poster_path"] != m.poster_path:
                    m.palette, m.dominant = [], None
                    for kind in ("poster", "poster_sm", "backdrop"):
                        media.media_file(kind, tmdb_id).unlink(missing_ok=True)
                m.sqlmodel_update(fields)
            else:
                m = Movie(tmdb_id=tmdb_id, **fields)
            m.fetched_at = now()
            await add_collection_parts(m)
            s.add(m)
    assert m is not None
    if not m.palette:
        await ensure_images(m, images)  # a new film needs its poster and palette now (fails fast offline)
    elif images != "none" and images_pending(m, images):
        jobs.enqueue(f"images:{tmdb_id}:{images}", lambda: _images_job(tmdb_id, images))  # never blocks the request
    s.add(m)
    s.commit()
    s.refresh(m)
    return m


def images_pending(m: Movie, level: str = "full") -> bool:
    kinds = {"full": ("poster", "poster_sm", "backdrop"), "wall": ("poster", "poster_sm")}.get(level, ())
    paths = {"poster": m.poster_path, "poster_sm": m.poster_path, "backdrop": m.backdrop_path}
    return not net.offline() and any(paths[k] and not media.media_file(k, m.tmdb_id).exists() for k in kinds)


async def _images_job(tmdb_id: int, level: str) -> None:
    from . import db  # late import: db imports models only

    with Session(db.engine) as s:
        m = s.get(Movie, tmdb_id)
        if m and await ensure_images(m, level):
            s.add(m)
            s.commit()


async def ensure_movies(s: Session, ids: list[int], images: str = "light") -> dict[int, Movie]:
    """Fetch many movies, 8 at a time; failures are skipped."""
    out: dict[int, Movie] = {}
    todo = [i for i in ids if not ((m := s.get(Movie, i)) and is_fresh(m))]
    for i in set(ids) - set(todo):
        out[i] = s.get(Movie, i)  # type: ignore[assignment]
    fetched = await asyncio.gather(*(_details(i) for i in todo))
    for tmdb_id, d in zip(todo, fetched):
        if d is None:
            continue
        fields = parse_details(d)
        m = s.get(Movie, tmdb_id)
        if m:
            m.sqlmodel_update(fields)
        else:
            m = Movie(tmdb_id=tmdb_id, **fields)
        m.fetched_at = now()
        s.add(m)
        out[tmdb_id] = m
    s.commit()
    if images != "none":
        await asyncio.gather(*(ensure_images(m, images) for m in out.values()))
        for m in out.values():
            s.add(m)
        s.commit()
    return out


async def _details(tmdb_id: int) -> dict | None:
    try:
        return await get(f"/movie/{tmdb_id}", append_to_response=DETAILS)
    except HTTPException:
        return None


async def find_imdb(imdb_id: str) -> dict | None:
    data = await get(f"/find/{imdb_id}", external_source="imdb_id")
    res = data.get("movie_results", [])
    return res[0] if res else None


async def lists(path: str, pages: int = 1, **params) -> list[dict]:
    out: list[dict] = []
    for p in range(1, pages + 1):
        try:
            out += (await get(path, page=p, **params)).get("results", [])
        except HTTPException:
            break
    return out


def age_days(m: Movie) -> float:
    fetched = m.fetched_at if m.fetched_at.tzinfo else m.fetched_at.replace(tzinfo=now().tzinfo)
    return (now() - fetched) / timedelta(days=1)


def utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=now().tzinfo)
