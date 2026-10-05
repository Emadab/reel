from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from .. import media, omdb, tmdb
from ..cards import film_card, watch_out, watch_stats, watchlist_ids
from ..db import get_session
from ..models import Movie, Watch, WatchlistItem
from ..recommender import service

router = APIRouter()


def _fmt(v: float | None) -> str | None:
    return f"{v:.1f}" if v else None


async def detail(s: Session, m: Movie) -> dict:
    await omdb.refresh_scores(s, m)
    st = watch_stats(s, [m.tmdb_id]).get(m.tmdb_id)
    card = film_card(m, st, s.get(WatchlistItem, m.tmdb_id) is not None)
    o = m.omdb or {}
    return {
        **card,
        "overview": m.overview,
        "tagline": m.tagline,
        "keywords": m.keywords[:8],
        "cast": [
            {**{k: c.get(k) for k in ("id", "name", "character")},
             "photo": f"/api/img/w185{c['profile_path']}" if c.get("profile_path") else None}
            for c in m.cast[:12]
        ],
        "crew_highlights": m.crew_highlights,
        "language": m.language,
        "release_date": m.release_date.isoformat() if m.release_date else None,
        "backdrop": media.media_url("backdrop", m.tmdb_id),
        "trailer_key": m.trailer_key,
        "imdb_id": m.imdb_id,
        "on_glow": media.on_glow_text(m.palette[0]) if m.palette else "#120904",
        "scores": {"tmdb": _fmt(m.tmdb_rating), "imdb": o.get("imdb"), "rt": o.get("rt"), "metacritic": o.get("metacritic")},
        "watches": [watch_out(w) for w in (st.watches if st else [])],
        "neighbors": service.neighbors(s, m),
        "fetched_at": tmdb.utc(m.fetched_at).isoformat(),
        "images_pending": tmdb.images_pending(m),
    }


@router.get("/movies/{tmdb_id}")
async def get_movie(tmdb_id: int, s: Session = Depends(get_session)):
    m = await tmdb.get_movie(s, tmdb_id)
    service.after_fetch([m.tmdb_id])
    return await detail(s, m)


@router.post("/movies/{tmdb_id}/refresh")
async def refresh(tmdb_id: int, s: Session = Depends(get_session)):
    m = await tmdb.get_movie(s, tmdb_id, force=True)
    await omdb.refresh_scores(s, m, force=True)
    service.after_fetch([m.tmdb_id], force=True)
    return await detail(s, m)


@router.delete("/movies/{tmdb_id}/watches", status_code=204)
def delete_all_watches(tmdb_id: int, s: Session = Depends(get_session)):
    for w in s.exec(select(Watch).where(Watch.tmdb_id == tmdb_id)):
        s.delete(w)
    s.commit()
    service.after_rating(s)
