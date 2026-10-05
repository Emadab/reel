from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from .. import jobs, media, omdb, tmdb
from ..cards import cards, film_card, watch_out, watch_stats, watchlist_ids
from ..db import get_session
from ..models import Movie, Watch, WatchlistItem
from ..recommender import service

router = APIRouter()


def _fmt(v: float | None) -> str | None:
    return f"{v:.1f}" if v else None


def _collection(s: Session, m: Movie) -> dict | None:
    col = (m.extra or {}).get("collection")
    if not col or len(col.get("parts", [])) < 2:
        return None
    ids = [p["id"] for p in col["parts"]]
    have = [m for m in (s.get(Movie, i) for i in ids) if m]
    known = {c["tmdb_id"]: c for c in cards(s, have)}
    films = []
    for p in col["parts"]:
        films.append(known.get(p["id"]) or {
            "tmdb_id": p["id"], "title": p["title"], "year": p["year"], "director": None, "runtime": None,
            "poster": f"/api/img/w342{p['poster_path']}" if p.get("poster_path") else None,
            "poster_sm": f"/api/img/w185{p['poster_path']}" if p.get("poster_path") else None,
            "palette": [], "poster_art": media.poster_art(p["id"], [], None), "genres": [], "my_rating": None,
            "watch_count": 0, "on_watchlist": False, "last_watched": None,
        })
    return {"name": col["name"], "films": films}


async def detail(s: Session, m: Movie) -> dict:
    await omdb.refresh_scores(s, m)
    if tmdb.needs_extra(m):
        jobs.enqueue(f"extra:{m.tmdb_id}", lambda i=m.tmdb_id: tmdb.extra_job(i))
    if m.omdb_fetched_at is None and m.imdb_id:
        jobs.enqueue(f"scores:{m.tmdb_id}", lambda i=m.tmdb_id: omdb.fill_scores([i]))
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
            for c in m.cast[:20]
        ],
        "crew_highlights": m.crew_highlights,
        "language": m.language,
        "release_date": m.release_date.isoformat() if m.release_date else None,
        "backdrop": media.media_url("backdrop", m.tmdb_id),
        "trailer_key": m.trailer_key,
        "imdb_id": m.imdb_id,
        "on_glow": media.on_glow_text(m.palette[0]) if m.palette else "#120904",
        "scores": {"tmdb": _fmt(m.tmdb_rating), "imdb": o.get("imdb"), "rt": o.get("rt"), "metacritic": o.get("metacritic")},
        "votes": {"tmdb": m.tmdb_votes, "imdb": int(o["imdb_votes"].replace(",", "")) if (o.get("imdb_votes") or "").replace(",", "").isdigit() else None},
        "awards": o.get("awards"),
        "original_title": m.original_title if m.original_title and m.original_title != m.title else None,
        "facts": {k: v for k, v in (m.extra or {}).items() if k != "collection"} | {"box_office": o.get("box_office")},
        "collection": _collection(s, m),
        "watches": [watch_out(w) for w in (st.watches if st else [])],
        "neighbors": service.neighbors(s, m),
        "fetched_at": tmdb.utc(m.fetched_at).isoformat(),
        # the page polls until images, scores and the extra details have landed
        "images_pending": tmdb.images_pending(m) or (m.omdb_fetched_at is None and bool(m.imdb_id)) or tmdb.needs_extra(m),
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
