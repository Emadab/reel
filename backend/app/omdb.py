"""Optional OMDb scores (IMDb, Rotten Tomatoes, Metacritic). Fetched when a detail page opens, and for the whole
library once a key is saved."""
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
    na = lambda v: None if not v or v == "N/A" else v  # noqa: E731
    rt = next((x["Value"] for x in d.get("Ratings", []) if x.get("Source") == "Rotten Tomatoes"), None)
    m.omdb = {"imdb": na(d.get("imdbRating")), "rt": na(rt), "metacritic": na(d.get("Metascore"))}
    m.omdb_fetched_at = now()
    s.add(m)
    s.commit()


async def check_key(key: str) -> bool:
    try:
        r = await client.get("https://www.omdbapi.com/", params={"i": "tt0111161", "apikey": key})
        return r.status_code == 200 and r.json().get("Response") == "True"
    except (httpx.HTTPError, ValueError):
        return False


async def fill_library() -> None:
    """Scores for every watched or watchlisted film that has none yet (one request each; a free key allows 1,000/day)."""
    with Session(db.engine) as s:
        q = select(Movie).where(Movie.imdb_id.is_not(None), Movie.omdb_fetched_at.is_(None)).where(
            or_(Movie.tmdb_id.in_(select(Watch.tmdb_id)), Movie.tmdb_id.in_(select(WatchlistItem.tmdb_id))))
        films = list(s.exec(q))
        for i, m in enumerate(films):
            await refresh_scores(s, m)
            jobs.progress("omdb:library", i + 1, len(films))
