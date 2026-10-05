import asyncio
import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlmodel import Session

from .. import media, tmdb
from ..cards import watch_stats, watchlist_ids
from ..db import get_session
from ..models import Movie

router = APIRouter()
_directors: dict[int, str | None] = {}


async def _director(tmdb_id: int) -> str | None:
    if tmdb_id not in _directors:
        try:
            crew = (await tmdb.get(f"/movie/{tmdb_id}/credits"))["crew"]
            _directors[tmdb_id] = ", ".join(c["name"] for c in crew if c.get("job") == "Director") or None
        except HTTPException:
            return None
    return _directors[tmdb_id]


def thumb_url(tmdb_id: int, poster_path: str | None) -> str | None:
    """The local copy if the movie is cached, otherwise the lazy image cache."""
    return media.media_url("poster_sm", tmdb_id) or (f"/api/img/w185{poster_path}" if poster_path else None)


@router.get("/search")
async def search(q: str, s: Session = Depends(get_session)):
    t0 = time.perf_counter()
    if len(q.strip()) < 2:
        return {"results": [], "took_ms": 0}
    raw = (await tmdb.search(q))[:8]
    ids = [r["id"] for r in raw]
    cached = {i: s.get(Movie, i) for i in ids}
    lookups = [asyncio.ensure_future(_director(i)) for i in ids if not cached[i] and i not in _directors]
    if lookups:  # don't hold results hostage: unfinished lookups keep running and fill the cache
        await asyncio.wait(lookups, timeout=0.6)
    directors = [cached[i].director if cached[i] else _directors.get(i) for i in ids]
    stats, wl = watch_stats(s, ids), watchlist_ids(s)
    results = []
    for r, director in zip(raw, directors):
        m = cached[r["id"]]
        results.append({
            "tmdb_id": r["id"],
            "title": r["title"],
            "year": tmdb._year(r.get("release_date")),
            "director": director,
            "poster_sm": thumb_url(r["id"], r.get("poster_path")),
            "poster_art": media.poster_art(r["id"], m.palette if m else [], m.dominant if m else None),
            "watch_count": stats[r["id"]].count if r["id"] in stats else 0,
            "on_watchlist": r["id"] in wl,
        })
    return {"results": results, "took_ms": round((time.perf_counter() - t0) * 1000)}


@router.get("/img/{size}/{name}", include_in_schema=False)
async def tmdb_image(size: str, name: str):
    if size not in ("w92", "w185", "w342", "w500") or "/" in name or ".." in name:
        raise HTTPException(404)
    try:
        f = await media.cached_tmdb_image(size, name)
    except Exception:
        raise HTTPException(404)
    return FileResponse(f, headers={"Cache-Control": "public, max-age=31536000, immutable"})
