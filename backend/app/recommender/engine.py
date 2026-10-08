"""One recommender for every medium. Films, shows, books and games each hand it the things you've had (with a
-1..1 signal), a candidate pool and the provider's "people who liked X liked Y" links; it returns a ranked,
diversified slate with calibrated probabilities, explanations and a held-out health check.

How it scores (all local, no network; ~100 ms for a thousand candidates):
- multi-interest kernel regression: each candidate borrows the ratings of its 20 nearest things you've had,
  softmax-weighted by similarity and decayed by recency, so separate tastes don't blur into one average.
  Embeddings are mean-centred first (bge vectors share a large common direction that hides differences);
- a taste vector (the old v1), similarity to things you dropped or disliked, and the closest thing you loved;
- item-to-item collaborative signal from the provider's recommendation graph (TMDB/RAWG/Open Library links
  out of what you've had, weighted by how much you liked the source);
- creator and genre affinity with leave-one-out shrinkage, a vote-count-shrunk public score, and era distance.
A model ladder learns how to combine them: a fixed prior, then L2 logistic regression, then monotone-constrained
LightGBM; each step is only used when it beats the simpler one on your most recent 20%. Probabilities are
sigmoid-calibrated, then the slate is picked by a DPP (fast greedy MAP, Chen et al. 2018) for relevance with
diversity, at most two per creator, with a few well-loved wildcards far from your usual taste."""
import math
import random
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date

import numpy as np

K = 20  # neighbours in the kernel regression
TAU = 0.07  # softmax temperature over centred cosine
DECAY_DAYS = 730  # recency e-folding: a two-year-old rating counts ~37%
PER_CREATOR = 2
ALPHA = 6.0  # DPP relevance weight: a near-duplicate needs ~0.1 more probability to beat something new
WILD_AT = (5, 13, 21)  # slate positions that hold a wildcard (~10% of what's shown)
HOLDOUT = 10
WILD_SCORE = 0.7  # wildcards are well loved by everyone: 7+ of 10 after vote-count shrinkage
NOT_A_REASON = {"aftercreditsstinger", "duringcreditsstinger", "sequel", "remake", "woman director", "based on novel or book",
                "large type books", "open syllabus project", "long now manual for civilization", "new york times bestseller",
                "fiction", "history", "accessible book", "steam cloud", "steam achievements", "full controller support",
                "partial controller support", "steam trading cards", "singleplayer", "multiplayer", "exclusive", "true exclusive"}
NAMES = ["affinity", "support", "dislike", "taste", "graph", "graph_n", "creator", "genre", "quality", "votes", "era"]
MONO = [1, 1, -1, 1, 1, 0, 1, 1, 1, 0, 0]  # LightGBM monotone constraints: more like what you love never hurts


@dataclass
class Thing:
    id: int
    emb: np.ndarray
    title: str
    genres: list[str] = field(default_factory=list)
    creators: list[str] = field(default_factory=list)  # directors, authors, developers, show creators
    tags: list[str] = field(default_factory=list)
    year: int | None = None
    public: float | None = None  # public score on a 0-10 scale
    votes: float = 0.0


@dataclass
class Label:
    thing: Thing
    y: float  # -1..1: how much you liked it
    pos: bool  # the target: rated 8+ (or loved without a rating)
    age: float  # days since
    had: bool = True  # watched/read/played, not just a reaction to a suggestion


@dataclass
class Slate:
    order: list[int]  # indices into the candidates, in slate order
    prob: np.ndarray
    wild: set[int]
    because: dict[int, list[int]]  # candidate index -> ids of things you loved that it's closest to
    reasons: dict[int, list[str]]
    model: str  # prior | logit | gbdt
    health: dict


def _unit(X: np.ndarray) -> np.ndarray:
    return X / (np.linalg.norm(X, axis=-1, keepdims=True) + 1e-9)


class Space:
    """Everything the features need from your history, built once per recompute."""

    def __init__(self, labels: list[Label], mean: np.ndarray, creator_noun: str = "creator"):
        self.labels, self.mean, self.noun = labels, mean, creator_noun
        self.ids = {lab.thing.id: j for j, lab in enumerate(labels)}
        self.E = self.centre([lab.thing for lab in labels]) if labels else np.zeros((0, len(mean)), np.float32)
        self.y = np.array([lab.y for lab in labels], dtype=float)
        self.pos = np.array([lab.pos for lab in labels], dtype=bool)
        self.rec = np.array([math.exp(-max(lab.age, 0) / DECAY_DAYS) for lab in labels])
        yc = self.y - (self.y.mean() if len(labels) else 0)
        self.tw = self.rec * yc  # taste-vector weights
        self.t = self.tw @ self.E if len(labels) else np.zeros(len(mean))
        self.creator_sum, self.creator_n = Counter(), Counter()
        self.genre_sum, self.genre_n = Counter(), Counter()
        for lab in labels:
            for c in set(lab.thing.creators):
                self.creator_sum[c] += lab.y
                self.creator_n[c] += 1
            for g in set(lab.thing.genres):
                self.genre_sum[g] += lab.y
                self.genre_n[g] += 1
        years = sorted(lab.thing.year for lab in labels if lab.thing.year)
        self.era = years[len(years) // 2] if years else 2000
        df = Counter(t for lab in labels for t in set(lab.thing.tags))  # tf-idf: tags you love, not tags everything has
        self.tag_weight = {t: k * math.log((len(labels) + 1) / df[t]) for t, k in
                           Counter(t for lab in labels if lab.pos for t in set(lab.thing.tags)).items()
                           if t.lower() not in NOT_A_REASON and "/" not in t and df[t] <= 0.4 * len(labels)}

    def centre(self, things: list[Thing]) -> np.ndarray:
        return _unit(np.stack([t.emb for t in things]) - self.mean).astype(np.float32)

    def features(self, things: list[Thing], edges_in: dict[int, list[tuple[int, float]]], prior: tuple[float, float],
                 loo: bool = False) -> np.ndarray:
        """One row per thing. `loo`: the things are `self.labels` themselves, each scored without its own label."""
        n, L = len(things), len(self.labels)
        X = np.zeros((n, len(NAMES)))
        if not n:
            return X
        Q = self.centre(things)
        if L:
            S = Q @ self.E.T
            if loo:
                np.fill_diagonal(S, -np.inf)
            k = min(K, L - 1 if loo else L)
            if k > 0:
                top = np.argpartition(-S, k - 1, axis=1)[:, :k]
                s = np.take_along_axis(S, top, 1)
                w = self.rec[top] * np.exp((s - s.max(axis=1, keepdims=True)) / TAU)
                X[:, 0] = (w * self.y[top]).sum(1) / (w.sum(1) + 1e-9)
            masked = lambda m: np.where(m[None, :], S, -1.0).max(1) if m.any() else np.full(n, -1.0)
            X[:, 1] = masked(self.pos)
            X[:, 2] = masked(self.y < 0)
            T = self.t[None, :] - (self.tw[:, None] * self.E if loo else 0)
            X[:, 3] = (Q * _unit(T)).sum(1)
        C, m = prior
        for i, t in enumerate(things):
            own = self.labels[i] if loo else None
            g = gn = 0.0
            for src, w in edges_in.get(t.id, ()):
                j = self.ids.get(src)
                if j is not None and j != (i if loo else -1):
                    g += w * self.rec[j] * self.y[j]
                    gn += w * self.rec[j]
            X[i, 4], X[i, 5] = g, math.log1p(gn)
            X[i, 6] = max((self._aff(self.creator_sum, self.creator_n, c, own, 1) for c in set(t.creators)), default=0.0)
            gs = [self._aff(self.genre_sum, self.genre_n, g_, own, 3) for g_ in set(t.genres)]
            X[i, 7] = sum(gs) / len(gs) if gs else 0.0
            v = t.votes or 0
            X[i, 8] = (t.public * v + C * m) / (v + m) / 10 if t.public is not None else C / 10
            X[i, 9] = math.log1p(v)
            X[i, 10] = abs((t.year or self.era) - self.era) / 10
        return X

    @staticmethod
    def _aff(sums: Counter, ns: Counter, key: str, own: Label | None, shrink: float) -> float:
        s, n = sums[key], ns[key]
        if own is not None and (key in own.thing.creators or key in own.thing.genres):
            s, n = s - own.y, n - 1
        return s / (n + shrink) if n > 0 else 0.0


def public_prior(things: list[Thing]) -> tuple[float, float]:
    """(mean public score, median vote count): the Bayesian average every score is shrunk towards."""
    scored = [t for t in things if t.public is not None]
    if not scored:
        return 6.5, 1.0
    votes = sorted(t.votes for t in scored)
    return float(np.mean([t.public for t in scored])), max(float(votes[len(votes) // 2]), 1.0)


# ---- the model ladder ----

def _prior(X: np.ndarray) -> np.ndarray:
    """Hand-set blend for when there's too little to learn from (a few ratings, or only one kind)."""
    z = 3.0 * X[:, 0] + 2.0 * (X[:, 1] - 0.3) - 1.5 * np.clip(X[:, 2] - X[:, 1], 0, None) + 1.0 * np.tanh(X[:, 4]) \
        + 0.8 * X[:, 6] + 0.5 * X[:, 7] + 4.0 * (X[:, 8] - 0.65) - 0.4
    return 1 / (1 + np.exp(-z))


def _fit(kind: str, X: np.ndarray, y: np.ndarray, calibrate: bool = True):
    if kind == "prior":
        return _prior
    if kind == "logit":
        from sklearn.linear_model import LogisticRegression
        from sklearn.pipeline import make_pipeline
        from sklearn.preprocessing import StandardScaler

        est = make_pipeline(StandardScaler(), LogisticRegression(C=0.3, max_iter=2000))
    else:
        from lightgbm import LGBMClassifier

        est = LGBMClassifier(n_estimators=150, learning_rate=0.05, num_leaves=7, min_child_samples=8, subsample=0.9,
                             subsample_freq=1, colsample_bytree=0.9, reg_lambda=1.0, monotone_constraints=MONO,
                             random_state=42, verbose=-1)
    if calibrate and kind == "gbdt" and min(y.sum(), len(y) - y.sum()) >= 6:
        from sklearn.calibration import CalibratedClassifierCV

        try:  # cross-validated sigmoid calibration so "87%" means something
            est = CalibratedClassifierCV(est, method="sigmoid", cv=3).fit(X, y)
            return lambda Z: est.predict_proba(Z)[:, 1]
        except ValueError:
            pass
    est.fit(X, y)
    return lambda Z: est.predict_proba(Z)[:, 1]


def _auc(y: np.ndarray, p: np.ndarray) -> float | None:
    from sklearn.metrics import roc_auc_score

    return float(roc_auc_score(y, p)) if 0 < y.sum() < len(y) else None


def relevance(labels: list[Label], XL: np.ndarray, XC: np.ndarray, seed: int = 7):
    """P(you'd pick it at all): what you've had (and liked suggestions) against a sample of the pool you haven't,
    the implicit-feedback half of the ranking. The rating model only knows what you thought of what you picked."""
    yes = np.array([lab.had or lab.y > 0 for lab in labels])
    no = np.array([not lab.had and lab.y < 0 for lab in labels])  # not interested
    rng = np.random.default_rng(seed)
    take = rng.choice(len(XC), size=min(len(XC), max(200, 3 * int(yes.sum()))), replace=False) if len(XC) else np.zeros(0, int)
    X = np.vstack([XL[yes], XL[no], XC[take]])
    y = np.r_[np.ones(yes.sum()), np.zeros(no.sum() + len(take))]
    if min(y.sum(), len(y) - y.sum()) < 3:
        return lambda Z: np.ones(len(Z))
    return _fit("logit", X, y.astype(int))


def choose(X: np.ndarray, y: np.ndarray, age: np.ndarray) -> str:
    """The simplest model that's best on your most recent 20% (trained on the older 80%)."""
    if min(y.sum(), len(y) - y.sum()) < 3:
        return "prior"
    order = np.argsort(-age)  # oldest first
    cut = int(len(y) * 0.8)
    tr, te = order[:cut], order[cut:]
    if len(te) < 8 or not 0 < y[te].sum() < len(te) or min(y[tr].sum(), len(tr) - y[tr].sum()) < 3:
        return "logit"  # can't hold out enough: regularised logistic is the safe learner
    best, best_auc = "prior", _auc(y[te], _prior(X[te])) or 0.0
    for kind, need in (("logit", 12), ("gbdt", 80)):
        if len(tr) < need:
            break
        a = _auc(y[te], _fit(kind, X[tr], y[tr], calibrate=False)(X[te])) or 0.0
        if a > best_auc + 0.01:
            best, best_auc = kind, a
    return best


# ---- slate ----

def dpp(E: np.ndarray, quality: np.ndarray, k: int, groups: list[list[str]]) -> list[int]:
    """Greedy MAP of a DPP with kernel L = diag(q) S diag(q) (Chen, Zhang & Zhou 2018): each pick maximises
    relevance times how much new ground it covers. At most PER_CREATOR picks share a creator."""
    n = len(E)
    if not n:
        return []
    q = np.exp(ALPHA * quality)
    S = np.clip(E @ E.T, 0, None) * 0.9 + 0.1 * np.eye(n)  # PSD-safe similarity of centred embeddings
    Lk = q[:, None] * S * q[None, :]
    d2 = np.diag(Lk).copy()
    C = np.zeros((k, n))
    chosen: list[int] = []
    per: Counter[str] = Counter()
    blocked = np.zeros(n, bool)
    while len(chosen) < k:
        cand = np.where(blocked, -np.inf, d2)
        j = int(np.argmax(cand))
        if not np.isfinite(cand[j]) or cand[j] <= 1e-12:
            break
        blocked[j] = True
        if any(per[g] >= PER_CREATOR for g in groups[j]):
            continue
        r = len(chosen)
        e = (Lk[j] - C[:r, j] @ C[:r]) / math.sqrt(d2[j])
        C[r] = e
        d2 = d2 - e**2
        chosen.append(j)
        per.update(set(groups[j]))
    return chosen


def recommend(labels: list[Label], cands: list[Thing], edges: dict[int, dict[int, float]], *, everything: list[Thing],
              creator_noun: str, today: date, keep: int = 60, wild_n: int = 5) -> Slate | None:
    if not labels:
        return None
    n = len(everything)
    # centring removes the direction every bge vector shares; shrunk on small pools, where the mean is mostly noise
    mean = np.stack([t.emb for t in everything]).mean(0) * n / (n + 100) if n else np.zeros_like(labels[0].thing.emb)
    edges_in: dict[int, list[tuple[int, float]]] = defaultdict(list)
    for src, dsts in edges.items():
        for dst, w in dsts.items():
            edges_in[dst].append((src, w))
    prior = public_prior(everything or [lab.thing for lab in labels] + cands)
    sp = Space(labels, mean, creator_noun)
    XL = sp.features([lab.thing for lab in labels], edges_in, prior, loo=True)
    y = sp.pos.astype(int)
    age = np.array([lab.age for lab in labels])
    kind = choose(XL, y, age)
    model = _fit(kind, XL, y)
    health = _health(labels, cands, edges_in, prior, mean, creator_noun, kind)
    if not cands:
        return Slate([], np.zeros(0), set(), {}, {}, kind, health)
    XC = sp.features(cands, edges_in, prior)
    prob = np.clip(model(XC), 0.0, 1.0)  # what the page shows: the chance you rate it 4+
    rank = prob * relevance(labels, XL, XC)(XC)  # what orders it: you'd pick it, and you'd love it
    rank = rank / (rank.max() or 1)

    # wildcards: the least like anything you love, but well loved by everyone; a different handful each day
    sup, q1 = XC[:, 1], float(np.quantile(XC[:, 1], 0.25))
    usual = {g for g, _ in Counter(g for lab in labels if lab.pos for g in lab.thing.genres).most_common(2)}
    far = [i for i in range(len(cands)) if sup[i] <= q1 and (XC[i, 8] >= WILD_SCORE or cands[i].public is None)  # books have no public score
           and not set(cands[i].genres) & usual]
    far.sort(key=lambda i: -XC[i, 8])
    far = far[: wild_n * 3]
    random.Random(today.isoformat()).shuffle(far)
    wild = far[:wild_n]
    wset = set(wild)

    normal = [i for i in np.argsort(-rank)[: keep * 3] if i not in wset]
    Ec = sp.centre([cands[i] for i in normal])
    picked = [normal[j] for j in dpp(Ec, rank[normal], keep, [cands[i].creators for i in normal])]
    order = list(picked)
    for slot, i in zip(WILD_AT, wild):
        order.insert(min(slot, len(order)), i)
    order += wild[len(WILD_AT):]

    because, reasons = {}, {}
    loved = [j for j, lab in enumerate(labels) if lab.pos and lab.had] or [j for j, lab in enumerate(labels) if lab.y > 0]
    Eloved = sp.E[loved] if loved else None
    for i in order:
        c = cands[i]
        if i in wset:
            reasons[i] = [wild_note(labels, c, creator_noun)]
            continue
        if Eloved is not None:
            sims = Eloved @ sp.centre([c])[0]
            because[i] = [labels[loved[j]].thing.id for j in np.argsort(-sims)[:2] if sims[j] > 0.05]
        reasons[i] = explain(sp, c)
    return Slate(order, prob, wset, because, reasons, kind, health)


def explain(sp: Space, c: Thing) -> list[str]:
    """Up to four short reasons: a shared creator with your best-loved thing by them, then shared tags."""
    out = []
    best: dict[str, Label] = {}
    for lab in sorted(sp.labels, key=lambda x: -x.y):
        if lab.pos:
            for cr in lab.thing.creators:
                best.setdefault(cr, lab)
    for cr in c.creators:
        if cr in best:
            out.append(f"same {sp.noun} as {best[cr].thing.title}")
            break
    shared = sorted((t for t in dict.fromkeys(c.tags) if sp.tag_weight.get(t, 0) > 0), key=lambda t: -sp.tag_weight[t])
    return out + shared[:3]


def wild_note(labels: list[Label], c: Thing, noun: str) -> str:
    top = [lab.thing for lab in sorted(labels, key=lambda x: -x.y)[:50]]
    genres = {g for t in top for g in t.genres}
    creators = {x for t in top for x in t.creators}
    if not set(c.genres) & genres and not set(c.creators) & creators:
        return f"Far from your usual taste: no genre or {noun} overlap with your top 50."
    if c.public is None:  # books: no public score to call it well loved
        return "Far from your usual taste: unlike anything you rate highly."
    return "Far from your usual taste: well loved, but unlike anything you rate highly."


def _health(labels, cands, edges_in, prior, mean, noun, kind) -> dict:
    """Hide your 10 most recent, rank them among the candidates using only what came before, count hits in the top 20.
    The baseline is the plain taste vector (v1)."""
    had = sorted((j for j, lab in enumerate(labels) if lab.had), key=lambda j: labels[j].age)
    if len(had) < HOLDOUT + 10:
        return {"hit_at_20": None, "baseline_hit_at_20": None, "holdout_n": HOLDOUT}
    held = set(had[:HOLDOUT])
    rest = [lab for j, lab in enumerate(labels) if j not in held]
    sp = Space(rest, mean, noun)
    pool = cands + [labels[j].thing for j in held]
    X = sp.features(pool, edges_in, prior)
    XL = sp.features([lab.thing for lab in rest], edges_in, prior, loo=True)
    y = sp.pos.astype(int)
    model = _fit(kind if min(y.sum(), len(y) - y.sum()) >= 3 else "prior", XL, y, calibrate=False)
    rel = relevance(rest, XL, X[: len(cands)])
    hit = lambda s: int(sum(i >= len(cands) for i in np.argsort(-s)[:20]))
    return {"hit_at_20": hit(model(X) * rel(X)), "baseline_hit_at_20": hit(X[:, 3]), "holdout_n": HOLDOUT}
