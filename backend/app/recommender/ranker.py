"""Scoring (ARCHITECTURE §5). v1 is a taste vector + MMR; v2 is a classifier for P(rating >= 8 of 10)."""
import math
import random
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime

import joblib
import numpy as np
from sqlmodel import Session, select

from ..cards import watch_stats
from ..config import settings
from ..models import Feedback, Movie
from . import features as F

LAMBDA = 0.7
SLATE = 13


@dataclass
class Profile:
    films: list[Movie]  # watched films that have embeddings
    ratings: dict[int, float | None]
    weights: dict[int, float]
    mu: float
    t: np.ndarray
    E: np.ndarray  # embeddings of `films`, row-aligned
    liked: list[Movie] = field(default_factory=list)  # rated >= 8 (or above mean if none are)
    liked_dirs: dict[int, Movie] = field(default_factory=dict)  # director id -> highest-rated film by them
    liked_cast: set[int] = field(default_factory=set)
    kw_freq: Counter = field(default_factory=Counter)

    def rating(self, m: Movie) -> float | None:
        return self.ratings.get(m.tmdb_id)


def build_profile(s: Session, exclude: set[int] = frozenset(), today: date | None = None) -> Profile | None:  # type: ignore[assignment]
    today = today or date.today()
    stats = watch_stats(s)
    films, ratings, ages = [], {}, {}
    for i, st in stats.items():
        if i in exclude:
            continue
        m = s.get(Movie, i)
        if not m or m.embedding is None:
            continue
        films.append(m)
        ratings[i] = st.my_rating
        ages[i] = (today - st.latest.watched_on).days
    if not films:
        return None
    rated = [r for r in ratings.values() if r is not None]
    mu = sum(rated) / len(rated) if rated else 7
    weights = {}
    for m in films:
        decay = math.exp(-max(ages[m.tmdb_id], 0) / 730)
        r = ratings[m.tmdb_id]
        weights[m.tmdb_id] = (r - mu) * decay if r is not None else 0.15 * decay
    E = F.matrix(films)
    w = np.array([weights[m.tmdb_id] for m in films])
    t = w @ E
    if np.linalg.norm(t) < 1e-6:  # e.g. every rating equals the mean: fall back to the plain centroid
        t = E.mean(axis=0)
    t = t / (np.linalg.norm(t) or 1)

    liked = [m for m in films if (ratings[m.tmdb_id] or 0) >= 8] or [m for m in films if (ratings[m.tmdb_id] or 0) > mu]
    liked.sort(key=lambda m: ratings[m.tmdb_id] or 0, reverse=True)
    p = Profile(films, ratings, weights, mu, t, E, liked)
    for m in liked:
        for d in F.director_ids(m):
            p.liked_dirs.setdefault(d, m)
        p.liked_cast |= F.top_cast(m)
        p.kw_freq.update(m.keywords)
    return p


def overlap(p: Profile, c: Movie) -> tuple[float, float]:
    d = 1.0 if F.director_ids(c) & set(p.liked_dirs) else 0.0
    cast = min(len(F.top_cast(c) & p.liked_cast), 3) / 3
    return d, cast


def v1_scores(p: Profile, cands: list[Movie]) -> tuple[np.ndarray, np.ndarray]:
    """(score, raw cosine) per candidate."""
    C = F.matrix(cands)
    cos = C @ p.t if len(cands) else np.zeros(0)
    bonus = np.array([0.05 * d + 0.03 * c for d, c in (overlap(p, m) for m in cands)])
    return cos + bonus, cos


def calibrator(s: Session, p: Profile):
    """Maps a v1 score onto P(rating >= 8): a Platt fit on my own ratings once there are 30, else a fixed curve."""
    rated = [m for m in p.films if p.rating(m) is not None]
    if len(rated) >= 30:
        xs, ys = [], []
        for i, m in enumerate(p.films):
            if p.rating(m) is None:
                continue
            loo = p.t * 1  # leave-one-out taste vector so a film doesn't explain itself
            loo = loo - p.weights[m.tmdb_id] * p.E[i]
            loo /= np.linalg.norm(loo) or 1
            xs.append(float(p.E[i] @ loo))
            ys.append(int(p.rating(m) >= 8))  # type: ignore[operator]
        if 0 < sum(ys) < len(ys):
            from sklearn.linear_model import LogisticRegression

            lr = LogisticRegression().fit(np.array(xs)[:, None], ys)
            return lambda v: lr.predict_proba(np.asarray(v)[:, None])[:, 1]
    return lambda v: 1 / (1 + np.exp(-9 * (np.asarray(v) - 0.42)))


# ---- v2 ----

def _row(p: Profile, m: Movie, e: np.ndarray, centroid: np.ndarray, med_decade: float, loo_w: float = 0.0) -> np.ndarray:
    t = p.t
    if loo_w:
        t = t - loo_w * e
        t = t / (np.linalg.norm(t) or 1)
    d, c = overlap(p, m)
    dec = (m.year or med_decade) // 10 * 10
    return np.concatenate([
        [float(e @ t), float(e @ centroid), d, c, (m.tmdb_rating or 6) / 10, math.log1p(m.popularity or 0),
         abs(dec - med_decade) / 10],
        F.structured(m),
    ])


def _context(p: Profile) -> tuple[np.ndarray, float]:
    top = sorted(p.films, key=lambda m: p.rating(m) or 0, reverse=True)[:20]
    centroid = F.matrix(top).mean(axis=0)
    centroid /= np.linalg.norm(centroid) or 1
    years = sorted(m.year for m in p.films if m.year)
    med = float(years[len(years) // 2] // 10 * 10) if years else 2000.0
    return centroid, med


def labels(s: Session, p: Profile, exclude: set[int] = frozenset()) -> list[tuple[Movie, int]]:  # type: ignore[assignment]
    out: dict[int, tuple[Movie, int]] = {}
    for m in p.films:  # the target is exactly what the UI shows: P(my rating >= 8)
        r = p.rating(m)
        if r is not None:
            out[m.tmdb_id] = (m, int(r >= 8))
    for f in s.exec(select(Feedback).order_by(Feedback.created_at)):
        if f.tmdb_id in exclude or f.tmdb_id in out and f.tmdb_id in p.ratings:
            continue
        m = s.get(Movie, f.tmdb_id)
        if not m or m.embedding is None:
            continue
        if f.signal in ("like", "added_watchlist"):
            out[f.tmdb_id] = (m, 1)
        elif f.signal in ("dislike", "not_interested"):
            out[f.tmdb_id] = (m, 0)
    return list(out.values())


@dataclass
class Model:
    version: str
    est: object
    n_labels: int

    def predict(self, p: Profile, cands: list[Movie]) -> np.ndarray:
        if not cands:
            return np.zeros(0)
        centroid, med = _context(p)
        X = np.stack([_row(p, m, F.vec(m), centroid, med) for m in cands])  # type: ignore[arg-type]
        return self.est.predict_proba(X)[:, 1]  # type: ignore[attr-defined]


def train(s: Session, p: Profile, exclude: set[int] = frozenset(), save: bool = True) -> Model | None:  # type: ignore[assignment]
    rows = labels(s, p, exclude)
    ys = [y for _, y in rows]
    if len(rows) < 50 or not 0 < sum(ys) < len(ys):
        return None
    centroid, med = _context(p)
    idx = {m.tmdb_id: i for i, m in enumerate(p.films)}
    X = np.stack([
        _row(p, m, F.vec(m), centroid, med, p.weights.get(m.tmdb_id, 0.0) if m.tmdb_id in idx else 0.0)  # type: ignore[arg-type]
        for m, _ in rows
    ])
    if len(rows) >= 150:
        from lightgbm import LGBMClassifier

        est = LGBMClassifier(num_leaves=15, n_estimators=200, learning_rate=0.05, verbose=-1).fit(X, ys)
    else:
        from sklearn.linear_model import LogisticRegression
        from sklearn.pipeline import make_pipeline
        from sklearn.preprocessing import StandardScaler

        est = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000, C=0.5)).fit(X, ys)
    est = _calibrated(est, X, ys)
    model = Model(f"v2-{datetime.now():%Y%m%d-%H%M}", est, len(rows))
    if save:
        joblib.dump(model, settings.models_dir / "ranker.joblib")
    return model


def _calibrated(est, X, ys):
    """Cross-validated sigmoid calibration so "87%" means something; falls back when a fold lacks a class."""
    from sklearn.base import clone
    from sklearn.calibration import CalibratedClassifierCV

    if min(sum(ys), len(ys) - sum(ys)) < 6:
        return est
    try:
        return CalibratedClassifierCV(clone(est), method="sigmoid", cv=3).fit(X, ys)
    except ValueError:
        return est


def load_model() -> Model | None:
    f = settings.models_dir / "ranker.joblib"
    try:
        return joblib.load(f) if f.exists() else None
    except Exception:
        return None


# ---- slate assembly ----

def mmr(cands: list[Movie], scores: np.ndarray, k: int, lam: float = LAMBDA, per_director: int = 2) -> list[int]:
    """Indices into `cands`, in order. At most `per_director` films per director in the result."""
    if not cands:
        return []
    E = F.matrix(cands)
    remaining = list(np.argsort(-scores))
    chosen: list[int] = []
    per: Counter[int] = Counter()
    max_sim = np.full(len(cands), -1.0)
    while remaining and len(chosen) < k:
        best, best_val = None, -1e9
        for i in remaining[:200]:  # the tail can't win against λ·score
            val = lam * scores[i] - (1 - lam) * (max_sim[i] if chosen else 0)
            if val > best_val:
                best, best_val = i, val
        remaining.remove(best)
        dirs = F.director_ids(cands[best])
        if any(per[d] >= per_director for d in dirs):
            continue
        chosen.append(best)
        per.update(dirs)
        max_sim = np.maximum(max_sim, E @ E[best])
    return chosen


def because(p: Profile, c: Movie) -> list[Movie]:
    e = F.vec(c)
    if e is None or not p.liked:
        return []
    sims = F.matrix(p.liked) @ e
    return [p.liked[i] for i in np.argsort(-sims)[:2]]


def reasons(p: Profile, c: Movie) -> list[str]:
    out = []
    for d in F.director_ids(c):
        if d in p.liked_dirs:
            out.append(f"same director as {p.liked_dirs[d].title}")
            break
    shared = sorted((k for k in c.keywords if p.kw_freq[k]), key=lambda k: -p.kw_freq[k])
    return out + shared[: 4 - len(out) if out else 3]


def wildcards(p: Profile, cands: list[Movie], cos: np.ndarray, n: int, today: date | None = None) -> list[int]:
    """Bottom quartile by cosine, but well-liked by everyone (TMDB >= 7.3, >= 500 votes). Seeded by date."""
    if not cands:
        return []
    q1 = float(np.quantile(cos, 0.25))
    pool = [i for i, m in enumerate(cands)
            if cos[i] <= q1 and (m.tmdb_rating or 0) >= 7.3 and (m.tmdb_votes or 0) >= 500]
    rnd = random.Random((today or date.today()).isoformat())
    rnd.shuffle(pool)
    return pool[:n]


def wildcard_note(p: Profile, c: Movie) -> str:
    top = sorted(p.films, key=lambda m: p.rating(m) or 0, reverse=True)[:50]
    genres = {g for m in top for g in m.genres}
    dirs = {d for m in top for d in F.director_ids(m)}
    if not set(c.genres) & genres and not F.director_ids(c) & dirs:
        return "Far from your usual taste: no genre or director overlap with your top 50."
    return "Far from your usual taste: well loved, but unlike anything you rate highly."
