"""2D projection of every cached film (ARCHITECTURE §6)."""
import json
import math
from collections import Counter

import joblib
import numpy as np
from sqlmodel import Session, select

from ..config import settings
from ..db import get_setting, put_setting
from ..models import Movie
from . import features as F

MARGIN = 0.04
MODEL_FILE = "umap.joblib"


def _normalise(xy: np.ndarray, bounds: list[float]) -> np.ndarray:
    x0, y0, x1, y1 = bounds
    span = np.array([max(x1 - x0, 1e-9), max(y1 - y0, 1e-9)])
    out = (xy - np.array([x0, y0])) / span
    return np.clip(MARGIN + out * (1 - 2 * MARGIN), 0, 1)


def _fit(E: np.ndarray) -> tuple[object | None, np.ndarray]:
    n = len(E)
    if n < 10:  # too few points for UMAP: a PCA layout is stable and honest
        if n < 3:
            return None, np.array([[0.5 + 0.2 * math.cos(i * 2.4), 0.5 + 0.2 * math.sin(i * 2.4)] for i in range(n)])
        from sklearn.decomposition import PCA

        return None, PCA(n_components=2, random_state=42).fit_transform(E)
    import umap

    reducer = umap.UMAP(n_neighbors=min(15, n - 1), min_dist=0.1, metric="cosine", random_state=42,
                        init="spectral" if n > 50 else "random")
    return reducer, reducer.fit_transform(E)


def update(s: Session, force: bool = False) -> None:
    """Refit when the film count has grown by more than 10%; otherwise place new films with transform()."""
    movies = list(s.exec(select(Movie).where(Movie.embedding.is_not(None))))  # type: ignore[union-attr]
    if not movies:
        return
    fitted_n = int(get_setting(s, "umap_n", "0") or 0)
    model_path = settings.models_dir / MODEL_FILE
    missing = [m for m in movies if m.umap_x is None]
    refit = force or fitted_n == 0 or len(movies) > fitted_n * 1.1 or (missing and not model_path.exists())
    if not refit and not missing:
        return
    if refit:
        reducer, xy = _fit(F.matrix(movies))
        bounds = [float(xy[:, 0].min()), float(xy[:, 1].min()), float(xy[:, 0].max()), float(xy[:, 1].max())]
        norm = _normalise(xy, bounds)
        for m, (x, y) in zip(movies, norm):
            m.umap_x, m.umap_y = float(x), float(y)
            s.add(m)
        if reducer is not None:
            joblib.dump(reducer, model_path)
        else:
            model_path.unlink(missing_ok=True)
        put_setting(s, "umap_n", str(len(movies)))
        put_setting(s, "umap_bounds", json.dumps(bounds))
    else:
        reducer = joblib.load(model_path)
        bounds = json.loads(get_setting(s, "umap_bounds", "[0,0,1,1]") or "[0,0,1,1]")
        norm = _normalise(reducer.transform(F.matrix(missing)), bounds)  # type: ignore[attr-defined]
        for m, (x, y) in zip(missing, norm):
            m.umap_x, m.umap_y = float(x), float(y)
            s.add(m)
    s.commit()
    put_setting(s, "clusters", json.dumps(clusters(movies)))


def clusters(movies: list[Movie]) -> list[dict]:
    """HDBSCAN on the 2D points, labelled by the two most over-represented genres/keywords (TF-IDF style)."""
    pts = [m for m in movies if m.umap_x is not None]
    if len(pts) < 12:
        return []
    from sklearn.cluster import HDBSCAN

    xy = np.array([[m.umap_x, m.umap_y] for m in pts])
    lab = HDBSCAN(min_cluster_size=max(4, min(8, len(pts) // 8))).fit_predict(xy)
    terms = [set(m.genres) | set(m.keywords[:12]) for m in pts]
    df = Counter(t for ts in terms for t in ts)
    n = len(pts)
    out = []
    for c in sorted(set(lab) - {-1}):
        idx = np.where(lab == c)[0]
        tf = Counter(t for i in idx for t in terms[i])
        score = {t: (k / len(idx)) * math.log(n / df[t]) for t, k in tf.items() if k >= 2}
        best = sorted(score, key=lambda t: -score[t])[:2]
        if not best:
            continue
        cx, cy = xy[idx].mean(axis=0)
        top = xy[idx][:, 1].min()
        out.append({"label": " & ".join(best).upper(), "x": round(float(cx), 4),
                    "y": round(float(max(top - 0.035, 0.02)), 4), "members": [pts[i].tmdb_id for i in idx]})
    return out


def cluster_of(s: Session) -> dict[int, str]:
    cl = json.loads(get_setting(s, "clusters", "[]") or "[]")
    return {i: c["label"] for c in cl for i in c["members"]}
