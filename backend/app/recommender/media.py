"""Recommendations and taste maps for shows, books and games, using the movie recommender's approach:
bge-small text embeddings, a taste vector, and a LightGBM ranker that is only used when it beats the plain
taste vector on held-out recent items. The movie recommender is untouched.

Tracking states are signals (REEL_EXPANSION Phase 8): finished/completed is a strong positive, dropping or a DNF
before 25% a strong negative, after 75% a mild negative, on hold neutral; a rating, when present, dominates."""
import asyncio
import logging
from collections import Counter
from datetime import UTC, datetime, timedelta

import numpy as np
from sqlmodel import Session, col, delete, select

from .. import db, items, jobs, media, tmdb
from ..models_media import ExternalId, Item, LibraryEntry, MediaCandidate, MediaFeedback, Run
from ..providers import openlibrary, rawg
from ..providers.base import SearchHit
from ..status import FINISHED
from . import features as F
from . import tastemap

log = logging.getLogger("reel.recs.media")
SLATE = 24
STALE = timedelta(hours=24)
DROPPED = {"dropped", "did_not_finish", "abandoned", "retired"}
SOURCE = {"show": "tmdb_tv", "book": "openlibrary", "game": "rawg"}
MIN_FOR_MODEL = 40
WILD_SLOTS = (3, 7, 11, 15, 19)  # where wildcards sit in the slate, like the movie page's ~20%
LIKE = 0.5  # "more like this" on something you haven't tried yet


def text(i: Item) -> str:
    who = i.details.get("authors") or i.details.get("networks") or i.details.get("platforms") or []
    return f"{i.title}. {', '.join(i.genres)}. {', '.join(who[:3])}. {', '.join(i.tags[:15])}. {(i.overview or '')[:600]}"


def fraction(kind: str, run: Run, item: Item) -> float | None:
    p = run.progress
    if kind == "show" and p.get("aired"):
        return p.get("watched", 0) / p["aired"]
    if kind == "book" and p.get("total") and p.get("current") is not None:
        return p["current"] / p["total"]
    if kind == "game":
        if p.get("percent") is not None:
            return p["percent"] / 100
        if p.get("hours") and item.details.get("playtime_hours"):
            return min(p["hours"] / item.details["playtime_hours"], 1)
    return None


def signal(kind: str, item: Item, run: Run | None, entry: LibraryEntry | None) -> float | None:
    """-1..1 for how much you liked it, or None when there's nothing to learn from."""
    if entry and entry.shelf == "not_interested":
        return -0.8
    if run is None or run.status is None:
        return 0.2 if entry and entry.shelf == "wishlist" else None
    state = None
    if run.status in FINISHED:
        state = 1.0
    elif run.status in DROPPED:
        f = fraction(kind, run, item)
        state = -1.0 if f is None or f < 0.25 else -0.3 if f > 0.75 else -0.6
    elif run.status in ("on_hold", "paused", "shelved"):
        state = 0.0
    else:  # in progress: engagement grows with how far you've got
        f = fraction(kind, run, item)
        state = 0.4 if f and f >= 0.5 else 0.15
    if run.rating is not None:
        return 0.7 * (run.rating - 5.5) / 4.5 + 0.3 * state
    return state


def labelled(s: Session, kind: str) -> list[tuple[Item, float, datetime]]:
    out = []
    rows = s.exec(select(Item, LibraryEntry).join(LibraryEntry, col(LibraryEntry.item_id) == col(Item.id)).where(Item.kind == kind)).all()
    for item, entry in rows:
        run = items.current_run(s, item.id)  # type: ignore[arg-type]
        w = signal(kind, item, run, entry)
        if w is not None:
            out.append((item, w, items.utc(run.updated_at if run else entry.added_at)))
    have = {i.id for i, _, _ in out}
    for fb, item in s.exec(select(MediaFeedback, Item).join(Item, col(Item.id) == col(MediaFeedback.item_id)).where(Item.kind == kind)):
        if item.id not in have:
            out.append((item, LIKE, items.utc(fb.created_at)))
    return out


async def embed_missing(s: Session, kind: str) -> None:
    todo = list(s.exec(select(Item).where(Item.kind == kind, col(Item.embedding).is_(None))))
    for start in range(0, len(todo), 32):
        batch = todo[start:start + 32]
        vecs = await asyncio.to_thread(F.embed_texts, [text(i) for i in batch])
        for i, v in zip(batch, vecs):
            i.embedding = np.asarray(v, dtype=np.float32).tobytes()
            s.add(i)
        s.commit()


def vec(i: Item) -> np.ndarray:
    return np.frombuffer(i.embedding, dtype=np.float32)  # type: ignore[arg-type]


def profile(rows: list[tuple[Item, float, datetime]]) -> np.ndarray | None:
    rows = [r for r in rows if r[0].embedding is not None and r[1] != 0]
    if not rows:
        return None
    t = sum(w * vec(i) for i, w, _ in rows)
    n = np.linalg.norm(t)
    return t / n if n > 0 else None


# ---- candidates ----

async def _light(s: Session, kind: str, h: SearchHit, overview: str | None = None, genres: list[str] | None = None) -> Item | None:
    """A candidate is cached with just its search-level data; opening it fetches the full record."""
    if item := items.find(s, h.source, h.ext_id):
        return item
    item = Item(kind=kind, title=h.title, year=h.year, overview=overview, genres=genres or [], details={"light": True})
    item.cover_path = await media.store_image(kind, h.cover_url)
    item.palette, item.dominant = media.palette_for(item.cover_path)
    s.add(item)
    s.flush()
    s.add(ExternalId(source=h.source, ext_id=h.ext_id, item_id=item.id))  # type: ignore[arg-type]
    s.commit()  # release SQLite's write lock before the next provider call writes its cache
    return item


async def candidates(s: Session, kind: str, seeds: list[Item]) -> dict[int, list[str]]:
    out: dict[int, list[str]] = {}

    def note(item: Item | None, tag: str) -> None:
        if item:
            out.setdefault(item.id, []).append(tag)  # type: ignore[arg-type]

    if kind == "show":
        names = {g["id"]: g["name"] for g in (await tmdb.get("/genre/tv/list")).get("genres", [])}
        for path in ("/tv/top_rated", "/trending/tv/week"):  # well-loved shows: where wildcards come from
            for r in await tmdb.lists(path):
                h = SearchHit("show", "tmdb_tv", str(r["id"]), r.get("name") or "?", int((r.get("first_air_date") or "0")[:4] or 0) or None,
                              None, f"{media.CDN}/w342{r['poster_path']}" if r.get("poster_path") else None)
                note(await _light(s, kind, h, r.get("overview"), [names.get(g, "") for g in r.get("genre_ids", []) if g in names]), "discover")
        for seed in seeds[:10]:
            row = s.exec(select(ExternalId).where(ExternalId.item_id == seed.id, ExternalId.source == "tmdb_tv")).first()
            if not row:
                continue
            for r in await tmdb.lists(f"/tv/{row.ext_id}/recommendations"):
                h = SearchHit("show", "tmdb_tv", str(r["id"]), r.get("name") or "?", int((r.get("first_air_date") or "0")[:4] or 0) or None,
                              None, f"{media.CDN}/w342{r['poster_path']}" if r.get("poster_path") else None)
                note(await _light(s, kind, h, r.get("overview"), [names.get(g, "") for g in r.get("genre_ids", []) if g in names]), f"because:{seed.id}")
    elif kind == "book":
        subjects = [g for seed in seeds[:8] for g in seed.genres[:2]]
        for subject in list(dict.fromkeys(subjects))[:6]:
            d = await openlibrary.api.get(f"/subjects/{subject.lower().replace(' ', '_')}.json", {"limit": 25}) or {}
            for w in d.get("works", []):
                h = SearchHit("book", "openlibrary", w["key"].rsplit("/", 1)[-1], w.get("title") or "?", w.get("first_publish_year"),
                              ", ".join(a["name"] for a in w.get("authors", [])[:2]) or None, openlibrary.cover(w.get("cover_id"), "M"))
                item = await _light(s, kind, h, None, [subject])
                if item and h.subtitle and "authors" not in item.details:
                    item.details = {**item.details, "authors": h.subtitle.split(", ")}
                    s.add(item)
                    s.commit()
                note(item, f"subject:{subject}")
    else:
        slugs = list(dict.fromkeys(g.lower().replace(" ", "-") for seed in seeds[:8] for g in seed.genres[:2]))[:3]
        for h in await rawg.discover(genres=slugs):
            note(await _light(s, kind, h), "discover")
        for seed in seeds[:6]:
            for h in seed.details.get("recs", []):
                note(await _light(s, kind, SearchHit(**h)), f"because:{seed.id}")
    s.commit()
    return out


# ---- ranking ----

def _features(i: Item, t: np.ndarray, liked_genres: set[str]) -> list[float]:
    e = vec(i)
    return [float(e @ t), len(liked_genres & set(i.genres)) / (len(i.genres) or 1), (i.year or 2000) / 2030.0]


def _auc(y: list[int], p: np.ndarray) -> float | None:
    from sklearn.metrics import roc_auc_score

    return float(roc_auc_score(y, p)) if 0 < sum(y) < len(y) else None


def maybe_model(rows: list[tuple[Item, float, datetime]], t: np.ndarray, liked_genres: set[str]):
    """LightGBM on your own labels, used only if it beats the taste vector on the most recent 20%."""
    rows = [r for r in rows if r[0].embedding is not None]
    if len(rows) < MIN_FOR_MODEL:
        return None
    rows.sort(key=lambda r: r[2])
    cut = int(len(rows) * 0.8)
    train, test = rows[:cut], rows[cut:]
    X = np.array([_features(i, t, liked_genres) for i, _, _ in train])
    y = [int(w > 0.3) for _, w, _ in train]
    if len(set(y)) < 2:
        return None
    import lightgbm as lgb

    model = lgb.LGBMClassifier(n_estimators=120, learning_rate=0.05, num_leaves=7, min_child_samples=5, random_state=42, verbose=-1)
    model.fit(X, y)
    Xt = np.array([_features(i, t, liked_genres) for i, _, _ in test])
    yt = [int(w > 0.3) for _, w, _ in test]
    ours, base = _auc(yt, model.predict_proba(Xt)[:, 1]), _auc(yt, Xt[:, 0])
    return model if ours is not None and base is not None and ours > base else None


async def recompute(s: Session, kind: str) -> None:
    rows = labelled(s, kind)
    await embed_missing(s, kind)
    rows = labelled(s, kind)
    seeds = [i for i, w, _ in sorted(rows, key=lambda r: -r[1]) if w > 0.3]
    try:
        sources = await candidates(s, kind, seeds) if seeds else {}
    except Exception as e:  # offline or no key: re-rank what we have
        log.warning("candidates for %s failed: %s", kind, e)
        sources = {c.item_id: c.sources for c in s.exec(select(MediaCandidate).where(MediaCandidate.kind == kind))}
    await embed_missing(s, kind)
    t = profile(rows)
    s.exec(delete(MediaCandidate).where(col(MediaCandidate.kind) == kind))  # type: ignore[call-overload]
    if t is None:
        s.commit()
        return
    mine = {i.id for i, _, _ in rows} | {e.item_id for e in s.exec(select(LibraryEntry))}
    pool = [i for iid in sources if iid not in mine and (i := s.get(Item, iid)) and i.embedding is not None]
    liked = [i for i, w, _ in rows if w > 0.3 and i.embedding is not None]
    liked_genres = {g for i in liked for g in i.genres}
    model = maybe_model(rows, t, liked_genres)
    if not pool:
        s.commit()
        return
    X = np.array([_features(i, t, liked_genres) for i in pool])
    score = model.predict_proba(X)[:, 1] if model else (X[:, 0] + 1) / 2
    order = [int(k) for k in np.argsort(-score)]
    # wildcards: below the visible slate and clear of your two favourite genres; well-loved ones first
    usual = [g for g, _ in Counter(g for i in liked for g in i.genres).most_common(2)]
    novel = [k for k in order[SLATE:] if pool[k].genres and not set(pool[k].genres) & set(usual)]
    novel.sort(key=lambda k: ("discover" not in sources.get(pool[k].id, []), -score[k]))  # type: ignore[arg-type]
    wild = novel[:len(WILD_SLOTS)]
    slate = [k for k in order if k not in wild][:SLATE * 2]
    for slot, k in zip(WILD_SLOTS, wild):
        slate.insert(min(slot, len(slate)), k)
    for rank, k in enumerate(slate):
        c = pool[k]
        is_wild = k in wild
        near = sorted(liked, key=lambda x: -float(vec(x) @ vec(c)))[:2]
        shared = [g for g in c.genres if g in liked_genres][:2]
        reasons = [f"{c.genres[0].lower()}, outside your usual {usual[0].lower() if usual else 'taste'}"] if is_wild else \
            [f"{', '.join(shared).lower()} like the ones you rate highly"] if shared else []
        s.add(MediaCandidate(item_id=c.id, kind=kind, score=float(score[k]), rank=rank, because=[] if is_wild else [n.id for n in near],  # type: ignore[arg-type, misc]
                             reasons=reasons, sources=sources.get(c.id, []), model="lightgbm" if model else "cosine", wildcard=is_wild))  # type: ignore[arg-type]
    s.commit()
    update_map(s, kind)


def update_map(s: Session, kind: str) -> None:
    """2D layout of your items and the slate (UMAP, PCA when there are few)."""
    slate = {c.item_id for c in s.exec(select(MediaCandidate).where(MediaCandidate.kind == kind))}
    mine = {e.item_id for e in s.exec(select(LibraryEntry))}
    pts = [i for i in s.exec(select(Item).where(Item.kind == kind, col(Item.embedding).is_not(None))) if i.id in mine or i.id in slate]
    if not pts:
        return
    E = np.stack([vec(i) for i in pts])
    _, xy = tastemap._fit(E)
    xy = np.asarray(xy)
    xy = tastemap._normalise(xy, [float(xy[:, 0].min()), float(xy[:, 1].min()), float(xy[:, 0].max()), float(xy[:, 1].max())])
    for i, (x, y) in zip(pts, xy):
        i.umap_x, i.umap_y = float(x), float(y)
        s.add(i)
    s.commit()


def request(kind: str) -> None:
    async def run() -> None:
        with Session(db.engine) as s:
            await recompute(s, kind)
    jobs.enqueue(f"recs:{kind}", run)


def is_stale(s: Session, kind: str) -> bool:
    c = s.exec(select(MediaCandidate).where(MediaCandidate.kind == kind)).first()
    return c is None or datetime.now(UTC) - items.utc(c.computed_at) > STALE


def neighbors(s: Session, item: Item, k: int = 6) -> list[dict]:
    """The film page's 'neighbours on your taste map' for a show, book or game: the closest of your own
    items and the current slate, by the same embeddings the suggestions use."""
    if item.embedding is None:
        return []
    slate = {c.item_id: c for c in s.exec(select(MediaCandidate).where(MediaCandidate.kind == item.kind))}
    lib = {e.item_id: e for e in s.exec(select(LibraryEntry)) if e.shelf != "not_interested"}
    pool = [x for i in (set(lib) | set(slate)) - {item.id} if (x := s.get(Item, i)) and x.kind == item.kind and x.embedding is not None]
    if not pool:
        return []
    sims = np.stack([vec(x) for x in pool]) @ vec(item)
    out = []
    for i in np.argsort(-sims)[:k]:
        x = pool[int(i)]
        out.append({"item": items.card(s, x, lib.get(x.id)), "score": round(slate[x.id].score, 3) if x.id in slate else None})  # type: ignore[index]
    return out


def embed_soon(kind: str) -> bool:
    """Embed this medium's new items in the background (a detail page's neighbours need it). False once
    embedding has failed, so the page stops waiting."""
    name = f"embed:{kind}"
    if jobs.status.get(name, {}).get("state") == "error":
        return False

    async def run() -> None:
        with Session(db.engine) as s:
            await embed_missing(s, kind)
    jobs.enqueue(name, run)
    return True
