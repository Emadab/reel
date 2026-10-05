from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from .. import tmdb
from ..cards import cards, fix_rewatches, normalize, watch_out
from ..db import get_session
from ..models import Movie, Watch, WatchIn, WatchlistItem, WatchPatch, now
from ..recommender import service

router = APIRouter()


def _get(s: Session, watch_id: int) -> Watch:
    w = s.get(Watch, watch_id)
    if not w:
        raise HTTPException(404, "Watch not found")
    return w


@router.post("/watches")
async def log_watch(body: WatchIn, s: Session = Depends(get_session)):
    await tmdb.get_movie(s, body.tmdb_id)
    w = Watch.model_validate(body)
    w.watched_on = normalize(w.watched_on, w.date_precision)
    w.rating = round(w.rating, 1) if w.rating is not None else None
    s.add(w)
    if wl := s.get(WatchlistItem, body.tmdb_id):
        s.delete(wl)
    s.commit()
    fix_rewatches(s, w.tmdb_id)
    s.refresh(w)
    service.after_fetch([w.tmdb_id])
    service.after_rating(s)
    return watch_out(w)


@router.patch("/watches/{watch_id}")
def edit_watch(watch_id: int, body: WatchPatch, s: Session = Depends(get_session)):
    w = _get(s, watch_id)
    w.sqlmodel_update(body.model_dump(exclude_unset=True))
    w.watched_on = normalize(w.watched_on, w.date_precision)
    w.rating = round(w.rating, 1) if w.rating is not None else None
    s.add(w)
    s.commit()
    fix_rewatches(s, w.tmdb_id)
    s.refresh(w)
    service.after_rating(s)
    return watch_out(w)


@router.delete("/watches/{watch_id}", status_code=204)
def delete_watch(watch_id: int, s: Session = Depends(get_session)):
    w = _get(s, watch_id)
    s.delete(w)
    s.commit()
    fix_rewatches(s, w.tmdb_id)


@router.get("/watches/recent")
def recent(limit: int = 5, s: Session = Depends(get_session)):
    """The last few distinct films logged (command palette empty state)."""
    ids: list[int] = []
    for w in s.exec(select(Watch).order_by(Watch.created_at.desc(), Watch.watched_on.desc(), Watch.id.desc()).limit(50)):
        if w.tmdb_id not in ids:
            ids.append(w.tmdb_id)
        if len(ids) == limit:
            break
    return cards(s, [m for i in ids if (m := s.get(Movie, i))])


@router.get("/watchlist")
def watchlist(s: Session = Depends(get_session)):
    rows = s.exec(
        select(WatchlistItem, Movie).join(Movie).order_by(WatchlistItem.priority.desc(), WatchlistItem.added_at.desc())
    ).all()
    out = cards(s, [m for _, m in rows])
    for c, (wl, _) in zip(out, rows):
        c.update(added_at=tmdb.utc(wl.added_at).isoformat(), priority=wl.priority)
    return out


@router.post("/watchlist/{tmdb_id}")
async def add_to_watchlist(tmdb_id: int, priority: int = 0, s: Session = Depends(get_session)):
    await tmdb.get_movie(s, tmdb_id)
    wl = s.get(WatchlistItem, tmdb_id) or WatchlistItem(tmdb_id=tmdb_id, added_at=now())
    wl.priority = priority
    s.add(wl)
    s.commit()
    service.after_fetch([tmdb_id])
    return {"tmdb_id": tmdb_id, "added_at": tmdb.utc(wl.added_at).isoformat(), "priority": wl.priority}


@router.delete("/watchlist/{tmdb_id}", status_code=204)
def remove_from_watchlist(tmdb_id: int, s: Session = Depends(get_session)):
    if wl := s.get(WatchlistItem, tmdb_id):
        s.delete(wl)
        s.commit()
