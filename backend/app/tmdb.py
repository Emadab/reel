import os
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import httpx
from colorthief import ColorThief
from dotenv import load_dotenv
from fastapi import HTTPException
from sqlmodel import Session

from .models import Movie

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")
TOKEN = os.getenv("TMDB_TOKEN", "")
DATA = Path(os.getenv("REEL_DATA", ROOT / "data"))
IMAGES = DATA / "posters"
IMAGES.mkdir(parents=True, exist_ok=True)
STALE = timedelta(days=30)
CDN = "https://image.tmdb.org/t/p"

api = httpx.AsyncClient(base_url="https://api.themoviedb.org/3", timeout=15)
img = httpx.AsyncClient(base_url=CDN, timeout=30)


async def _get(path: str, **params) -> dict:
    if not TOKEN:
        raise HTTPException(503, "TMDB_TOKEN missing: put it in backend/.env")
    r = await api.get(path, params=params, headers={"Authorization": f"Bearer {TOKEN}"})
    if r.status_code == 404:
        raise HTTPException(404, "Not found on TMDB")
    r.raise_for_status()
    return r.json()


async def search(q: str) -> list[dict]:
    data = await _get("/search/movie", query=q, include_adult="false")
    return [
        {
            "tmdb_id": m["id"],
            "title": m["title"],
            "year": int(m["release_date"][:4]) if m.get("release_date") else None,
            "poster_url": f"{CDN}/w185{m['poster_path']}" if m.get("poster_path") else None,
            "overview": m.get("overview", ""),
        }
        for m in data["results"]
    ]


async def _download(path: str | None, size: str) -> str | None:
    if not path:
        return None
    name = size + path.replace("/", "_")
    f = IMAGES / name
    if not f.exists():
        r = await img.get(f"/{size}{path}")
        r.raise_for_status()
        f.write_bytes(r.content)
    return name


def _palette(name: str | None) -> list[str]:
    if not name:
        return []
    return ["#%02x%02x%02x" % c for c in ColorThief(IMAGES / name).get_palette(color_count=5, quality=10)]


async def get_movie(s: Session, tmdb_id: int) -> Movie:
    """Cached movie, refetched from TMDB when older than STALE. Falls back to the stale copy when offline."""
    m = s.get(Movie, tmdb_id)
    if m and datetime.now(UTC) - m.fetched_at < STALE:
        return m
    try:
        d = await _get(f"/movie/{tmdb_id}", append_to_response="credits,keywords,videos,release_dates,external_ids")
        poster = await _download(d.get("poster_path"), "w500")
        backdrop = await _download(d.get("backdrop_path"), "w1280")
    except httpx.HTTPError:
        if m:
            return m
        raise HTTPException(502, "TMDB unreachable")
    rd = d.get("release_date") or None
    data = dict(
        imdb_id=d.get("external_ids", {}).get("imdb_id"),
        title=d["title"],
        release_date=date.fromisoformat(rd) if rd else None,
        year=int(rd[:4]) if rd else None,
        runtime=d.get("runtime") or None,
        overview=d.get("overview") or "",
        tagline=d.get("tagline") or "",
        genres=[g["name"] for g in d.get("genres", [])],
        director=next((c["name"] for c in d["credits"]["crew"] if c["job"] == "Director"), None),
        cast=[{"name": c["name"], "character": c.get("character"), "profile_path": c.get("profile_path")}
              for c in d["credits"]["cast"][:15]],
        keywords=[k["name"] for k in d["keywords"]["keywords"]],
        language=d.get("original_language"),
        poster_path=poster,
        backdrop_path=backdrop,
        trailer_key=next((v["key"] for v in d["videos"]["results"]
                          if v["site"] == "YouTube" and v["type"] == "Trailer"), None),
        palette=_palette(poster),
        tmdb_rating=d.get("vote_average"),
        fetched_at=datetime.now(UTC),
    )
    if m:
        m.sqlmodel_update(data)
    else:
        m = Movie(tmdb_id=tmdb_id, **data)
    s.add(m)
    s.commit()
    s.refresh(m)
    return m
