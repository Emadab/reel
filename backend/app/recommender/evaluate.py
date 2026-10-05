"""Held-out evaluation: hide my 10 most recent films, rank a pool containing them, count hits in the top 20."""
import numpy as np
from sqlmodel import Session

from ..cards import watch_stats
from ..models import Movie
from . import ranker

HOLDOUT = 10


def evaluate(s: Session, pool: list[Movie]) -> dict | None:
    stats = watch_stats(s)
    recent = sorted(stats, key=lambda i: (stats[i].latest.watched_on, stats[i].latest.id or 0), reverse=True)
    held = [i for i in recent if (m := s.get(Movie, i)) and m.embedding is not None][:HOLDOUT]
    if len(stats) < HOLDOUT + 10 or len(held) < HOLDOUT:
        return None
    held_set = set(held)
    p = ranker.build_profile(s, exclude=held_set)
    if p is None:
        return None
    seen = set(stats) - held_set
    universe = [m for m in pool if m.tmdb_id not in seen and m.embedding is not None and m.tmdb_id not in held_set]
    universe += [s.get(Movie, i) for i in held]  # type: ignore[misc]

    def hits(scores: np.ndarray) -> int:
        top = np.argsort(-scores)[:20]
        return sum(universe[i].tmdb_id in held_set for i in top)

    v1, _ = ranker.v1_scores(p, universe)
    baseline = hits(v1)
    model = ranker.train(s, p, exclude=held_set, save=False)
    current = hits(model.predict(p, universe)) if model else baseline
    return {"hit_at_20": current, "baseline_hit_at_20": baseline, "holdout_n": HOLDOUT}
