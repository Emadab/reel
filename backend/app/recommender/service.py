"""Orchestration: background jobs, recompute triggers, and the response builders for recommendations,
the taste map and detail-page neighbours."""
import asyncio
import json
import re
from datetime import date, datetime, timedelta

import numpy as np
from fastapi import HTTPException
from sqlmodel import Session, delete, func, select

from .. import db, jobs
from ..cards import film_card, watch_stats, watchlist_ids
from ..db import get_setting, put_setting
from ..models import Candidate, Feedback, Movie, now
from ..tmdb import utc
from . import candidates, evaluate, ranker, tastemap
from . import features as F

RECOMPUTE_EVERY = 3
STALE = timedelta(hours=24)


# ---- triggers ----

def after_fetch(ids: list[int] | None = None, force: bool = False) -> None:
    jobs.enqueue("embed", _embed_job)


def after_rating(s: Session) -> None:
    _count_change(s)


def after_feedback(s: Session) -> None:
    _count_change(s)


def _count_change(s: Session) -> None:
    n = int(get_setting(s, "rec_changes", "0") or 0) + 1
    if n >= RECOMPUTE_EVERY or not s.exec(select(Candidate).limit(1)).first():
        n = 0
        request_recompute()
    put_setting(s, "rec_changes", str(n))


def request_recompute() -> None:
    jobs.enqueue("embed", _embed_job)
    jobs.enqueue("recommendations", _recompute_job)


def on_startup() -> None:
    with Session(db.engine) as s:
        jobs.enqueue("embed", _embed_job)
        meta = _meta(s)
        stale = not meta or now() - datetime.fromisoformat(meta["computed_at"]) > STALE
        if stale and _ratings_count(s) >= 10:
            jobs.enqueue("recommendations", _recompute_job)


async def _embed_job() -> None:
    with Session(db.engine) as s:
        await F.embed_missing(s, progress=lambda d, t: jobs.progress("embed", d, t))
        await asyncio.to_thread(tastemap.update, s)  # UMAP is CPU-heavy: keep the API responsive


async def _recompute_job() -> None:
    with Session(db.engine) as s:
        await recompute(s)


# ---- the slate ----

def _ratings_count(s: Session) -> int:
    return sum(1 for st in watch_stats(s).values() if st.my_rating is not None)


def _meta(s: Session) -> dict | None:
    raw = get_setting(s, "rec_meta")
    return json.loads(raw) if raw else None


async def recompute(s: Session) -> None:
    old = {c.tmdb_id: c.sources for c in s.exec(select(Candidate))}
    try:
        sources = await candidates.generate(s)
    except HTTPException:  # offline or no token: re-rank the pool we already have
        skip = candidates.excluded(s)
        sources = {i: src for i, src in old.items() if i not in skip}
    await F.embed_missing(s)
    await asyncio.to_thread(_rank, s, sources)  # scoring, training and UMAP stay off the event loop


NOT_A_FILM = re.compile(r"(trilogy|collection|anthology|making of|behind the scenes|featurette)", re.I)


def eligible(m: Movie, docs_ok: bool) -> bool:
    """Real, released feature films only: no compilations, shorts, extras or barely-rated titles."""
    today = date.today()
    return (
        40 <= (m.runtime or 0) <= 240
        and (m.tmdb_votes or 0) >= 150
        and not (m.release_date and m.release_date > today)
        and not NOT_A_FILM.search(m.title)
        and (docs_ok or "Documentary" not in m.genres)
    )


def _rank(s: Session, sources: dict[int, list[str]]) -> None:
    p = ranker.build_profile(s)
    if p is None:
        return
    docs_ok = any("Documentary" in m.genres for m in p.films)
    cands = [m for i in sources if (m := s.get(Movie, i)) and m.embedding is not None and eligible(m, docs_ok)]
    if not cands:
        return
    score, cos = ranker.v1_scores(p, cands)
    model = ranker.train(s, p)
    prob = model.predict(p, cands) if model else ranker.calibrator(s, p)(score)
    rank_by = prob if model else score

    n_wild = max(1, round(0.1 * ranker.SLATE))
    wild = ranker.wildcards(p, cands, cos, n=5)
    normal = [i for i in range(len(cands)) if i not in set(wild)]
    ordered = [normal[j] for j in ranker.mmr([cands[i] for i in normal], rank_by[normal], k=60)]
    slate = ordered[: ranker.SLATE - n_wild] + wild[:n_wild] + ordered[ranker.SLATE - n_wild:] + wild[n_wild:]

    version = model.version if model else "v1"
    s.exec(delete(Candidate))  # type: ignore[call-overload]
    for rank, i in enumerate(slate):
        m = cands[i]
        s.add(Candidate(
            tmdb_id=m.tmdb_id, sources=sources.get(m.tmdb_id, []), score=float(prob[i]), is_wildcard=i in wild,
            because=[b.tmdb_id for b in ranker.because(p, m)] if i not in wild else [],
            reasons=ranker.reasons(p, m) if i not in wild else [], rank=rank, model_version=version,
        ))
    s.commit()
    health = evaluate.evaluate(s, cands) or {}
    shown = min(len(slate), ranker.SLATE)
    health.update(candidate_count=len(cands), sources=candidates.source_labels(sources),
                  wildcard_share=round(min(n_wild, len(wild)) / shown, 2) if shown else 0)
    put_setting(s, "rec_health", json.dumps(health))
    put_setting(s, "rec_meta", json.dumps({
        "version": version.split("-")[0], "full_version": version, "ratings_used": _ratings_count(s),
        "reactions_used": s.exec(select(func.count()).select_from(Feedback)).one(), "computed_at": now().isoformat(),
    }))
    tastemap.update(s)


# ---- responses ----

def _reaction(s: Session, since: datetime | None) -> dict[int, str]:
    q = select(Feedback).order_by(Feedback.created_at)
    out: dict[int, str] = {}
    for f in s.exec(q):
        if f.signal in ("like", "not_interested", "added_watchlist") and (since is None or utc(f.created_at) >= since):
            out[f.tmdb_id] = f.signal
    return out


def rec_out(s: Session, m: Movie, c: Candidate | None, stats, wl, reaction: str | None = None) -> dict:
    because = [s.get(Movie, i) for i in (c.because if c else [])]
    b_cards = [film_card(b, stats.get(b.tmdb_id)) for b in because if b]
    why = ranker.wildcard_note(p, m) if c and c.is_wildcard and (p := ranker.build_profile(s)) else None
    return {
        **film_card(m, stats.get(m.tmdb_id), m.tmdb_id in wl),
        "score": round(c.score, 3) if c else None,
        "is_wildcard": bool(c and c.is_wildcard),
        "because": b_cards,
        "reasons": c.reasons if c else [],
        "why": why,
        "overview": m.overview,
        "glow": m.palette[0] if m.palette else None,
        "reaction": reaction,
    }


def recommendations(s: Session, filter: str = "all") -> dict:
    meta = _meta(s)
    ratings = _ratings_count(s)
    rows = list(s.exec(select(Candidate).order_by(Candidate.rank)))
    computed = datetime.fromisoformat(meta["computed_at"]) if meta else None
    reaction = _reaction(s, computed)
    stats, wl = watch_stats(s), watchlist_ids(s)
    seen = set(stats)
    picked = []
    for c in rows:
        m = s.get(Movie, c.tmdb_id)
        if not m or c.tmdb_id in seen:
            continue
        if filter == "short" and not (m.runtime and m.runtime < 120):
            continue
        if filter == "wild" and not c.is_wildcard:
            continue
        picked.append(rec_out(s, m, c, stats, wl, reaction.get(m.tmdb_id)))
        if len(picked) == ranker.SLATE:
            break
    health = json.loads(get_setting(s, "rec_health", "{}") or "{}")
    if not rows and ratings >= 10:
        request_recompute()
    return {
        "model": meta and {k: meta[k] for k in ("version", "ratings_used", "reactions_used", "computed_at")},
        "onboarding": ratings < 10,
        "computing": jobs.status.get("recommendations", {}).get("state") in ("queued", "running"),
        "top": picked[0] if picked else None,
        "items": picked[1:],
        "health": {"hit_at_20": None, "baseline_hit_at_20": None, "holdout_n": evaluate.HOLDOUT,
                   "candidate_count": 0, "sources": [], "wildcard_share": 0, **health},
    }


def neighbors(s: Session, m: Movie, k: int = 6) -> list[dict]:
    e = F.vec(m)
    if e is None:
        return []
    stats, wl = watch_stats(s), watchlist_ids(s)
    slate = {c.tmdb_id: c for c in s.exec(select(Candidate).where(Candidate.rank < 60))}
    pool = [x for i in (set(stats) | set(slate)) - {m.tmdb_id} if (x := s.get(Movie, i)) and x.embedding is not None]
    if not pool:
        return []
    sims = F.matrix(pool) @ e
    out = []
    for i in np.argsort(-sims)[:k]:
        x = pool[i]
        watched = x.tmdb_id in stats
        out.append({"film": film_card(x, stats.get(x.tmdb_id), x.tmdb_id in wl),
                    "kind": "watched" if watched else "suggested",
                    "score": None if watched else round(slate[x.tmdb_id].score, 3)})
    return out


def tastemap_points(s: Session) -> dict:
    stats = watch_stats(s)
    slate = {c.tmdb_id: c for c in s.exec(select(Candidate).order_by(Candidate.rank).limit(ranker.SLATE))}
    movies = list(s.exec(select(Movie).where(Movie.umap_x.is_not(None))))  # type: ignore[union-attr]
    points = []
    for m in movies:
        st = stats.get(m.tmdb_id)
        base = {"tmdb_id": m.tmdb_id, "title": m.title, "x": round(m.umap_x, 4), "y": round(m.umap_y, 4)}  # type: ignore[arg-type]
        if st:
            art = film_card(m, st)
            points.append({**base, "kind": "watched", "rating": st.my_rating,
                           "color": m.palette[0] if m.palette else art["poster_art"]["bg"],
                           "bg": art["poster_art"]["bg"], "poster_sm": art["poster_sm"]})
        elif m.tmdb_id in slate:
            c = slate[m.tmdb_id]
            points.append({**base, "kind": "suggested", "score": round(c.score, 3), "is_wildcard": c.is_wildcard})
        else:
            points.append({**base, "kind": "candidate"})
    cl = json.loads(get_setting(s, "clusters", "[]") or "[]")
    top = next(iter(slate), None)
    return {
        "film_count": len(movies),
        "points": points,
        "clusters": [{k: c[k] for k in ("label", "x", "y")} for c in cl],
        "default_selected": top,
    }


def explain(s: Session, tmdb_id: int) -> dict:
    m = s.get(Movie, tmdb_id)
    if not m:
        raise HTTPException(404, "Not cached")
    stats, wl = watch_stats(s), watchlist_ids(s)
    c = s.get(Candidate, tmdb_id)
    film = rec_out(s, m, c, stats, wl)
    p = ranker.build_profile(s)
    e = F.vec(m)
    nearest: list[dict] = []
    if p and e is not None:
        rated = [x for x in p.films if p.rating(x) is not None and x.tmdb_id != tmdb_id]
        pool = [x for x in rated if (p.rating(x) or 0) >= 8] or rated
        if pool:
            sims = F.matrix(pool) @ e
            for i in np.argsort(-sims)[:3]:
                nearest.append({"film": film_card(pool[i], stats.get(pool[i].tmdb_id)), "similarity": round(float(sims[i]), 2)})
    return {"film": film, "nearest": nearest, "note": _note(s, m, c, p, nearest)}


def _note(s: Session, m: Movie, c: Candidate | None, p, nearest: list[dict]) -> str:
    if c and c.is_wildcard:
        return "A wildcard: deliberately far from everything you rate highly, so the model keeps learning outside its comfort zone."
    if p:
        for d in F.director_ids(m):
            if d in p.liked_dirs:
                best = p.liked_dirs[d]
                genre = (best.genres[0].lower() + " film") if best.genres else "film"
                return f"Same director as your highest-rated {genre}, {best.title}."
    labels = tastemap.cluster_of(s)
    near_labels = []
    for n in nearest:
        lab = labels.get(n["film"]["tmdb_id"])
        if lab and lab not in near_labels:
            near_labels.append(lab)
    if len(near_labels) >= 2:
        a, b = (x.lower() for x in near_labels[:2])
        return f"Sits between your {a} films and your {b} ones."
    if nearest:
        n = nearest[0]["film"]
        rating = f" ★ {n['my_rating']:g}" if n.get("my_rating") else ""
        return f"Closest to {n['title']}{rating} in story and themes."
    return "Not enough rated films nearby to explain this one yet."
