from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from .. import tmdb
from ..cards import cards, watch_stats
from ..db import get_session, get_setting, put_setting
from ..models import Feedback, Signal, now
from ..recommender import service

router = APIRouter()


class FeedbackIn(BaseModel):
    tmdb_id: int
    signal: Signal


@router.get("/recommendations")
def recommendations(filter: Literal["all", "short", "wild"] = "all", s: Session = Depends(get_session)):
    return service.recommendations(s, filter)


@router.post("/recommendations/recompute", status_code=202)
def recompute():
    service.request_recompute()
    return {"queued": True}


@router.post("/feedback", status_code=201)
def feedback(body: FeedbackIn, s: Session = Depends(get_session)):
    s.add(Feedback(tmdb_id=body.tmdb_id, signal=body.signal))
    s.commit()
    if body.signal != "opened":
        service.after_feedback(s)
    return {"ok": True}


@router.delete("/feedback/{tmdb_id}/{signal}", status_code=204)
def undo_feedback(tmdb_id: int, signal: Signal, s: Session = Depends(get_session)):
    """Toggling a reaction off removes the most recent one."""
    f = s.exec(select(Feedback).where(Feedback.tmdb_id == tmdb_id, Feedback.signal == signal)
               .order_by(Feedback.created_at.desc())).first()
    if f:
        s.delete(f)
        s.commit()


@router.get("/tastemap")
def tastemap(s: Session = Depends(get_session)):
    return service.tastemap_points(s)


@router.get("/tastemap/explain/{tmdb_id}")
def explain(tmdb_id: int, s: Session = Depends(get_session)):
    return service.explain(s, tmdb_id)


@router.get("/onboarding")
async def onboarding(s: Session = Depends(get_session)):
    """20 well-known films to rate: TMDB's top-rated and popular lists, refreshed daily."""
    stamp = get_setting(s, "onboarding_at")
    ids = [int(x) for x in (get_setting(s, "onboarding_ids", "") or "").split(",") if x]
    if not ids or not stamp or now() - tmdb.utc(datetime.fromisoformat(stamp)) > timedelta(days=1):
        pool = await tmdb.lists("/movie/top_rated", pages=2) + await tmdb.lists("/movie/popular")
        pool.sort(key=lambda r: r.get("vote_count", 0), reverse=True)
        ids = list(dict.fromkeys(r["id"] for r in pool))[:60]
        put_setting(s, "onboarding_ids", ",".join(map(str, ids)))
        put_setting(s, "onboarding_at", now().isoformat())
    seen = set(watch_stats(s))
    skipped = _skipped(s)
    ids = [i for i in ids if i not in seen and i not in skipped][:20]
    movies = await tmdb.ensure_movies(s, ids, images="light")
    return cards(s, [movies[i] for i in ids if i in movies])


def _skipped(s: Session) -> set[int]:
    return {int(x) for x in (get_setting(s, "onboarding_skipped", "") or "").split(",") if x}


@router.post("/onboarding/skip/{tmdb_id}", status_code=204)
def skip(tmdb_id: int, s: Session = Depends(get_session)):
    """'Haven't seen it': hide the film from onboarding without telling the recommender anything."""
    put_setting(s, "onboarding_skipped", ",".join(map(str, _skipped(s) | {tmdb_id})))
