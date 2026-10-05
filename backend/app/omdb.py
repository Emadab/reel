"""Optional OMDb scores (IMDb, Rotten Tomatoes, Metacritic). Fetched only when a detail page opens."""
import httpx
from sqlmodel import Session

from .config import settings
from .models import Movie, now
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
