"""Recommendations for shows, books and games: the same engine as films (engine.py), fed by each medium's
providers. Candidates come from the recommendations stored with what you've had (offline-safe), discovery lists,
and for books more by the authors you love; offline, everything already cached is the pool.

Tracking states are signals (REEL_EXPANSION Phase 8): finished/completed is a strong positive, dropping or a DNF
before 25% a strong negative, after 75% a mild negative, on hold neutral; a rating, when present, dominates."""
import asyncio
import json
import logging
import re
from collections import Counter
from datetime import UTC, date, datetime, timedelta

import numpy as np
from sqlmodel import Session, col, delete, select

from .. import db, items, jobs, media, tmdb
from ..db import put_setting
from ..models_media import (
    ExternalId,
    Item,
    ItemPerson,
    LibraryEntry,
    MediaCandidate,
    MediaFeedback,
    Person,
    Run,
)
from ..providers import openlibrary, rawg
from ..providers.base import SearchHit
from ..status import FINISHED
from . import engine, tastemap
from . import features as F

log = logging.getLogger("reel.recs.media")
SLATE = 24
STALE = timedelta(hours=24)
DROPPED = {"dropped", "did_not_finish", "abandoned", "retired"}
SOURCE = {"show": "tmdb_tv", "book": "openlibrary", "game": "rawg"}
NOUN = {"show": "creator", "book": "author", "game": "developer"}
LIKE = 0.5  # "more like this" on something you haven't tried yet
NOT_A_BOOK = re.compile(r"\b(works|anthology|omnibus|textbook|literature \[grade|volume \d+)\b", re.I)  # compilations, set texts
ENRICH = 40  # light candidates enriched per recompute (one cached provider call each)


def text(i: Item) -> str:
    who = i.details.get("authors") or i.details.get("creators") or i.details.get("networks") or i.details.get("platforms") or []
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


def _rows(s: Session, kind: str) -> list[tuple[Item, float, datetime, float | None, bool]]:
    """(item, signal, when, rating, had it) for everything you've tracked, then "more like this" reactions."""
    entries = {e.item_id: e for e in s.exec(select(LibraryEntry).join(Item, col(Item.id) == col(LibraryEntry.item_id)).where(Item.kind == kind))}
    runs = {i.id: r for i, r in items.current_runs(s, kind)}
    out = []
    for item in s.exec(select(Item).where(col(Item.id).in_(list(entries)))):
        entry, run = entries[item.id], runs.get(item.id)  # type: ignore[index]
        w = signal(kind, item, run, entry)
        if w is not None:
            out.append((item, w, items.utc(run.updated_at if run else entry.added_at), run.rating if run else None,
                        run is not None and run.status is not None))
    have = {r[0].id for r in out}
    for fb, item in s.exec(select(MediaFeedback, Item).join(Item, col(Item.id) == col(MediaFeedback.item_id)).where(Item.kind == kind)):
        if item.id not in have:
            out.append((item, LIKE, items.utc(fb.created_at), None, False))
    return out


def labelled(s: Session, kind: str) -> list[tuple[Item, float, datetime]]:
    return [(i, w, at) for i, w, at, _, _ in _rows(s, kind)]


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


def norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]", "", t.lower())


def same_as_owned(title: str, owned: set[str]) -> bool:
    """Another edition of something you have: 'Pride and Prejudice' twice, or 'The Witcher 3 Wild Hunt -
    Complete Edition' when you have 'The Witcher 3: Wild Hunt', or 'La tempestosa (Wuthering Heights)'."""
    t = norm_title(title)
    return t in owned or any(len(o) >= 6 and t.startswith(o) or len(o) >= 10 and o in t for o in owned)


# ---- candidates (each source fails on its own; offline, what's cached is the pool) ----

async def _light(s: Session, kind: str, h: SearchHit, overview: str | None = None, genres: list[str] | None = None,
                 details: dict | None = None) -> Item | None:
    """A candidate is cached with its list-level data. Its cover is downloaded only if it makes the slate, and
    opening it fetches the full record."""
    if item := items.find(s, h.source, h.ext_id):
        return item
    item = Item(kind=kind, title=h.title, year=h.year, overview=overview, genres=genres or [],
                details={"light": True, "cover_url": h.cover_url, **(details or {})})
    s.add(item)
    s.flush()
    s.add(ExternalId(source=h.source, ext_id=h.ext_id, item_id=item.id))  # type: ignore[arg-type]
    s.commit()  # release SQLite's write lock before the next provider call writes its cache
    return item


def _tv_hit(r: dict) -> SearchHit:
    return SearchHit("show", "tmdb_tv", str(r["id"]), r.get("name") or "?", int((r.get("first_air_date") or "0")[:4] or 0) or None,
                     None, f"{media.CDN}/w342{r['poster_path']}" if r.get("poster_path") else None)


async def _quietly(coro, what: str):
    try:
        return await coro
    except Exception as e:  # offline, filtered or no key: the other sources still count
        log.info("recs source %s skipped: %s", what, e)
        return None


async def candidates(s: Session, kind: str, seeds: list[Item]) -> dict[int, list[str]]:
    out: dict[int, list[str]] = {}

    def note(item: Item | None, tag: str) -> None:
        if item and tag not in out.setdefault(item.id, []):  # type: ignore[arg-type]
            out[item.id].append(tag)  # type: ignore[index]

    for seed in seeds[:10]:  # the provider's recommendations stored with each item work offline
        for h in seed.details.get("recs", [])[:20]:
            note(await _light(s, kind, SearchHit(**h)), f"because:{seed.id}")
    if kind == "show":
        names = {g["id"]: g["name"] for g in ((await _quietly(tmdb.get("/genre/tv/list"), "tv genres")) or {}).get("genres", [])}

        async def tv(rows: list[dict] | None, tag: str) -> None:
            for r in rows or []:
                note(await _light(s, kind, _tv_hit(r), r.get("overview"), [names[g] for g in r.get("genre_ids", []) if g in names],
                                  {"tmdb_rating": r.get("vote_average"), "tmdb_votes": r.get("vote_count")}), tag)

        for path in ("/tv/top_rated", "/trending/tv/week"):  # well-loved shows: where wildcards come from
            await tv(await _quietly(tmdb.lists(path), path), "discover")
        for seed in seeds[:10]:
            row = s.exec(select(ExternalId).where(ExternalId.item_id == seed.id, ExternalId.source == "tmdb_tv")).first()
            if row:
                await tv(await _quietly(tmdb.lists(f"/tv/{row.ext_id}/recommendations"), "tv recs"), f"because:{seed.id}")
    elif kind == "book":
        subjects = [g for seed in seeds[:8] for g in seed.genres[:2]]
        for subject in list(dict.fromkeys(subjects))[:6]:
            d = await _quietly(openlibrary.api.get(f"/subjects/{subject.lower().replace(' ', '_')}.json", {"limit": 25}), subject) or {}
            for w in d.get("works", []):
                authors = [a["name"] for a in w.get("authors", [])[:2]]
                h = SearchHit("book", "openlibrary", w["key"].rsplit("/", 1)[-1], w.get("title") or "?", w.get("first_publish_year"),
                              ", ".join(authors) or None, openlibrary.cover(w.get("cover_id"), "M"))
                note(await _light(s, kind, h, None, [subject], {"authors": authors}), f"subject:{subject}")
        for a in list(dict.fromkeys(a for seed in seeds[:8] for a in seed.details.get("author_ids", [])[:1]))[:5]:
            names = next((seed.details.get("authors", [])[:1] for seed in seeds if a in seed.details.get("author_ids", [])), [])
            for h in (await _quietly(openlibrary.author_works(a), f"author {a}") or [])[:10]:  # more by authors you love
                note(await _light(s, kind, h, None, None, {"authors": names}), f"author:{a}")
    else:
        slugs = list(dict.fromkeys(g.lower().replace(" ", "-") for seed in seeds[:8] for g in seed.genres[:2]))[:3]
        tags = [t for t, _ in Counter(t.lower().replace(" ", "-") for seed in seeds[:8] for t in seed.tags[:8]).most_common(3)]
        for found in (await _quietly(rawg.discover(genres=slugs), "rawg genres"), await _quietly(rawg.discover(tags=tags), "rawg tags")):
            for h in found or []:
                note(await _light(s, kind, h), "discover")
    s.commit()
    return out


async def enrich(kind: str, ext_id: str) -> dict:
    """One provider call that gives a light candidate real genres, tags, people and a public score, so it's
    ranked on what it is, not just its title. Cached; the full record still waits until it's opened.
    Touches no database rows (the caller applies the result), so calls can run side by side."""
    if kind == "show":
        r = await tmdb.get(f"/tv/{ext_id}", append_to_response="keywords")
        return {"genres": [g["name"] for g in r.get("genres", [])], "tags": [k["name"] for k in (r.get("keywords") or {}).get("results", [])][:20],
                "overview": r.get("overview"), "details": {"creators": [c["name"] for c in r.get("created_by", [])],
                "networks": [n["name"] for n in r.get("networks", [])], "tmdb_rating": r.get("vote_average"), "tmdb_votes": r.get("vote_count")}}
    if kind == "book":
        w = await openlibrary.api.get(f"/works/{ext_id}.json", ttl=30 * 86400) or {}
        subjects = openlibrary._subjects(w.get("subjects", []))
        return {"genres": subjects[:6], "tags": subjects[6:24], "overview": openlibrary._text(w.get("description")), "details": {}}
    g = await rawg.api.get(f"/games/{ext_id}", rawg._key()) or {}
    return {"genres": [x["name"] for x in g.get("genres", [])], "tags": [t["name"] for t in g.get("tags", [])[:20] if t.get("language", "eng") == "eng"],
            "overview": g.get("description_raw"), "details": {
                "creators": [x["name"] for x in g.get("developers", [])], "rating": g.get("rating"), "rating_votes": g.get("ratings_count"),
                "metacritic": g.get("metacritic"), "playtime_hours": g.get("playtime") or None,
                "platforms": [p["platform"]["name"] for p in g.get("platforms") or [] if p.get("platform")]}}


async def _enrich_all(s: Session, kind: str, light: list[Item]) -> None:
    ext = {e.item_id: e.ext_id for e in s.exec(select(ExternalId).where(col(ExternalId.item_id).in_([i.id for i in light]), ExternalId.source == SOURCE[kind]))}
    s.commit()  # no open transaction while the calls run: each one writes the HTTP cache
    gate = asyncio.Semaphore(4)

    async def one(i: Item) -> dict | None:
        async with gate:
            return await _quietly(enrich(kind, ext[i.id]), f"enrich {i.id}") if i.id in ext else None
    for i, got in zip(light, await asyncio.gather(*(one(i) for i in light))):
        if not got:
            continue
        i.genres = got["genres"] or i.genres
        i.tags = got["tags"] or i.tags
        i.overview = got["overview"] or i.overview
        i.details = {**i.details, **got["details"], "enriched": True}
        i.embedding = i.umap_x = i.umap_y = None  # re-embedded and re-placed with the richer text
        s.add(i)
    s.commit()


async def _covers(s: Session, slate: list[Item]) -> None:
    for item in slate:
        if not item.cover_path and (url := item.details.get("cover_url")):
            item.cover_path = await _quietly(media.store_image(item.kind, url), "cover")
            if item.cover_path:
                item.palette, item.dominant = await asyncio.to_thread(media.palette_for, item.cover_path)  # CPU-bound
                s.add(item)
    s.commit()


# ---- ranking ----

def _creators(s: Session, kind: str) -> dict[int, list[str]]:
    out: dict[int, list[str]] = {}
    q = (select(ItemPerson, Person).join(Person, col(Person.id) == col(ItemPerson.person_id)).join(Item, col(Item.id) == col(ItemPerson.item_id))
         .where(Item.kind == kind, ItemPerson.role == NOUN[kind]))
    for ip, p in s.exec(q):
        out.setdefault(ip.item_id, []).append(p.name)
    return out


def thing(i: Item, creators: dict[int, list[str]]) -> engine.Thing:
    d = i.details
    public, votes = None, 0.0
    if i.kind == "show" and d.get("tmdb_rating"):
        public, votes = d["tmdb_rating"], d.get("tmdb_votes") or 0
    elif i.kind == "game" and d.get("rating"):
        public, votes = d["rating"] * 2, d.get("rating_votes") or 0  # RAWG rates out of 5
    elif i.kind == "game" and d.get("metacritic"):
        public, votes = d["metacritic"] / 10, 50
    who = creators.get(i.id) or d.get("creators") or (d.get("authors") if i.kind == "book" else None) or []  # type: ignore[arg-type]
    return engine.Thing(i.id, vec(i), i.title, list(i.genres), list(who), list(i.tags), i.year, public, float(votes))  # type: ignore[arg-type]


def _edges(s: Session, kind: str, sources: list[Item]) -> dict[int, dict[int, float]]:
    """The provider's own "if you liked this" lists, stored with each item you have."""
    ext = {(e.source, e.ext_id): e.item_id for e in s.exec(select(ExternalId).join(Item, col(Item.id) == col(ExternalId.item_id)).where(Item.kind == kind))}
    out: dict[int, dict[int, float]] = {}
    for i in sources:
        for rank, h in enumerate(i.details.get("recs", [])[:20]):
            if (dst := ext.get((h["source"], h["ext_id"]))) and dst != i.id:
                out.setdefault(i.id, {})[dst] = 1 / (rank + 1) ** 0.5  # type: ignore[index]
    return out


def _rank(s: Session, kind: str, rows, today: date) -> tuple[engine.Slate | None, list[Item]]:
    creators = _creators(s, kind)
    mine = {e.item_id for e in s.exec(select(LibraryEntry))}
    owned = {norm_title(i.title) for i, *_ in rows if i.id in mine}
    now = datetime.now(UTC)
    labels = [engine.Label(thing(i, creators), w, r >= 8 if r is not None else w >= 0.9, (now - at).days, had)
              for i, w, at, r, had in rows if i.embedding is not None]
    pool = [i for i in s.exec(select(Item).where(Item.kind == kind, col(Item.embedding).is_not(None)))
            if i.id not in mine and not same_as_owned(i.title, owned) and not (kind == "book" and NOT_A_BOOK.search(i.title))]
    everything = [lab.thing for lab in labels] + [thing(i, creators) for i in pool]
    slate = engine.recommend(labels, everything[len(labels):], _edges(s, kind, [r[0] for r in rows]), everything=everything,
                             creator_noun=NOUN[kind], today=today, keep=SLATE * 2)
    return slate, pool


async def recompute(s: Session, kind: str) -> None:
    await embed_missing(s, kind)
    rows = _rows(s, kind)
    seeds = [i for i, w, *_ in sorted(rows, key=lambda r: -r[1]) if w > 0.3]
    sources = await candidates(s, kind, seeds) if seeds else {}
    await embed_missing(s, kind)
    today = date.today()
    slate, pool = await asyncio.to_thread(_rank, s, kind, rows, today)  # CPU work off the event loop: requests keep flowing
    if slate is not None:
        light = [pool[k] for k in slate.order if pool[k].details.get("light") and not pool[k].details.get("enriched")][:ENRICH]
        if light:  # rank again once the likely picks are described properly
            await _enrich_all(s, kind, light)
            await embed_missing(s, kind)
            slate, pool = await asyncio.to_thread(_rank, s, kind, rows, today)
    s.exec(delete(MediaCandidate).where(col(MediaCandidate.kind) == kind))  # type: ignore[call-overload]
    if slate is None:
        s.commit()
        return
    await _covers(s, [pool[k] for k in slate.order])
    for rank, k in enumerate(slate.order):
        c = pool[k]
        s.add(MediaCandidate(item_id=c.id, kind=kind, score=float(slate.prob[k]), rank=rank, because=slate.because.get(k, []),  # type: ignore[arg-type]
                             reasons=slate.reasons.get(k, []), sources=sources.get(c.id, ["cache"]), model=slate.model,  # type: ignore[arg-type]
                             wildcard=k in slate.wild))
    shown = min(len(slate.order), SLATE)
    tags = {t.split(":")[0] for k in slate.order for t in sources.get(pool[k].id, ["cache"])}  # type: ignore[arg-type]
    names = [x for x, on in (("provider recs", "because" in tags), ("discover", bool(tags & {"discover", "subject"})),
                             ("authors you love", "author" in tags), ("your cache", "cache" in tags)) if on]
    put_setting(s, f"rec_health:{kind}", json.dumps(dict(
        slate.health, candidate_count=len(pool), sources=names,
        wildcard_share=round(sum(k in slate.wild for k in slate.order[:shown]) / shown, 2) if shown else 0)))
    put_setting(s, f"rec_meta:{kind}", json.dumps({
        "version": "v3", "full_version": f"v3-{slate.model}", "ratings_used": sum(1 for r in rows if r[4]),
        "reactions_used": sum(1 for r in rows if not r[4]), "computed_at": datetime.now(UTC).isoformat()}))
    await asyncio.to_thread(update_map, s, kind)  # UMAP is CPU-heavy


def update_map(s: Session, kind: str) -> None:
    """2D layout of every cached item of this medium, exactly like the film map: yours, the slate and the unseen
    candidates, with labelled clusters. Incremental: new items are placed into the existing fit."""
    pts = list(s.exec(select(Item).where(Item.kind == kind, col(Item.embedding).is_not(None))))
    if tastemap.place(s, pts, lambda xs: np.stack([vec(i) for i in xs]), f":{kind}"):
        put_setting(s, f"clusters:{kind}", json.dumps(tastemap.clusters([(i.id, i.umap_x, i.umap_y, i.genres + i.tags[:12]) for i in pts])))  # type: ignore[misc]


def explain(s: Session, item: Item) -> dict:
    """The taste map's side panel: the closest things you rated highly, and one sentence on why."""
    c = s.get(MediaCandidate, item.id)
    rows = [(i, r) for i, w, _, r, _ in _rows(s, item.kind) if r is not None and i.id != item.id and i.embedding is not None]
    nearest: list[dict] = []
    if rows and item.embedding is not None:
        pool = [i for i, r in rows if r >= 8] or [i for i, _ in rows]
        sims = np.stack([vec(i) for i in pool]) @ vec(item)
        nearest = [{"item": items.card(s, pool[int(j)]), "similarity": round(float(sims[j]), 2)} for j in np.argsort(-sims)[:3]]
    noun = NOUN[item.kind]
    if c and c.wildcard:
        note = "A wildcard: deliberately far from everything you rate highly, so the model keeps learning outside its comfort zone."
    else:
        creators = _creators(s, item.kind)
        mine = set(thing(item, creators).creators) if item.embedding is not None else set()
        best = next((i for i, r in sorted(rows, key=lambda ir: -ir[1]) if r >= 8 and mine & set(thing(i, creators).creators)), None)
        labels = tastemap.cluster_of(s, f"clusters:{item.kind}")
        near = list(dict.fromkeys(lab for n in nearest if (lab := labels.get(n["item"]["id"]))))
        many = {"show": "shows", "book": "books", "game": "games"}[item.kind]
        if best:
            note = f"Same {noun} as one of your highest-rated {many}, {best.title}."
        elif len(near) >= 2:
            note = f"Sits between your {near[0].lower()} {many} and your {near[1].lower()} ones."
        elif nearest:
            n = nearest[0]["item"]
            stars = f" ★ {n['my_rating']:g}" if n.get("my_rating") else ""
            note = f"Closest to {n['title']}{stars} in story and themes."
        else:
            note = f"Not enough rated {many} nearby to explain this one yet."
    return {"nearest": nearest, "note": note}


def request(kind: str) -> None:
    async def run() -> None:
        with Session(db.engine) as s:
            await recompute(s, kind)
        if kind == "game":
            from .. import games  # late import: games imports this module

            games.request_box_art()  # new suggestions arrive with RAWG screenshots
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
