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
    movies = list(s.exec(select(Movie).where(Movie.embedding.is_not(None))))  # type: ignore[union-attr]
    if place(s, movies, F.matrix, "", force):
        put_setting(s, "clusters", json.dumps(clusters([(m.tmdb_id, m.umap_x, m.umap_y, m.genres + m.keywords[:12]) for m in movies])))


def place(s: Session, objs: list, matrix, key: str, force: bool = False) -> bool:
    """Lay out films or items (anything with umap_x/umap_y): refit when the count has grown by more than 10%,
    otherwise place only the new ones with transform(). `key` keeps each medium's fit apart ("" is films).
    True when anything moved."""
    if not objs:
        return False
    fitted_n = int(get_setting(s, f"umap_n{key}", "0") or 0)
    model_path = settings.models_dir / MODEL_FILE.replace(".", f"{key.replace(':', '-')}.")
    missing = [m for m in objs if m.umap_x is None]
    refit = force or fitted_n == 0 or len(objs) > fitted_n * 1.1 or (missing and not model_path.exists())
    if not refit and not missing:
        return False
    if refit:
        reducer, xy = _fit(matrix(objs))
        bounds = [float(xy[:, 0].min()), float(xy[:, 1].min()), float(xy[:, 0].max()), float(xy[:, 1].max())]
        todo, norm = objs, _normalise(xy, bounds)
        if reducer is not None:
            joblib.dump(reducer, model_path)
        else:
            model_path.unlink(missing_ok=True)
        put_setting(s, f"umap_n{key}", str(len(objs)))
        put_setting(s, f"umap_bounds{key}", json.dumps(bounds))
    else:
        reducer = joblib.load(model_path)
        bounds = json.loads(get_setting(s, f"umap_bounds{key}", "[0,0,1,1]") or "[0,0,1,1]")
        todo, norm = missing, _normalise(reducer.transform(matrix(missing)), bounds)  # type: ignore[attr-defined]
    for m, (x, y) in zip(todo, norm):
        m.umap_x, m.umap_y = float(x), float(y)
        s.add(m)
    s.commit()
    return True


def clusters(points: list[tuple[int, float | None, float | None, list[str]]]) -> list[dict]:
    """HDBSCAN on the 2D points (id, x, y, genres + tags), labelled by the two most over-represented terms
    (TF-IDF style). The same for every medium."""
    pts = [p for p in points if p[1] is not None]
    if len(pts) < 12:
        return []
    from sklearn.cluster import HDBSCAN

    xy = np.array([[x, y] for _, x, y, _ in pts])
    lab = HDBSCAN(min_cluster_size=max(4, min(8, len(pts) // 8))).fit_predict(xy)
    terms = [set(t) for *_, t in pts]
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
                    "y": round(float(max(top - 0.035, 0.02)), 4), "members": [pts[i][0] for i in idx]})
    return out


def cluster_of(s: Session, key: str = "clusters") -> dict[int, str]:
    cl = json.loads(get_setting(s, key, "[]") or "[]")
    return {i: c["label"] for c in cl for i in c["members"]}
