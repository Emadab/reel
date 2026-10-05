"""Shows, books and games API. Every route 404s while its medium's flag is off."""
from datetime import UTC, date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, col, delete, select

from .. import books, games, items, shows
from ..db import get_session
from ..flags import require_kind
from ..models_media import Event, Item, ItemPerson, LibraryEntry, Person, Run, Season
from ..providers import PRIMARY
from ..status import STICKY, allowed, transition

router = APIRouter(prefix="/media")
Kind = Literal["show", "book", "game"]
Shelf = Literal["wishlist", "backlog", "not_interested"]
Precision = Literal["day", "month", "year", "unknown"]
INACTIVE = timedelta(weeks=6)
SUGGEST = {"watching": "on_hold", "playing": "shelved"}


def _item(s: Session, item_id: int) -> Item:
    item = items.get_item(s, item_id)
    require_kind(s, item.kind)
    return item


def _run(s: Session, run_id: int) -> tuple[Run, Item]:
    run = s.get(Run, run_id)
    if not run:
        raise HTTPException(404, "Not found")
    return run, _item(s, run.item_id)


# ---- search and add ----

@router.get("/{kind}/search")
async def search(kind: Kind, q: str, s: Session = Depends(get_session)):
    """Your own items first, then the provider's results (marked when already in your library)."""
    require_kind(s, kind)
    q = q.strip()
    if len(q) < 2:
        return {"local": [], "results": []}
    local = [i for i in s.exec(select(Item).where(Item.kind == kind, col(Item.title).ilike(f"%{q}%")).limit(6))]
    hits = await PRIMARY[kind].search(q, kind)
    out = []
    for h in hits:
        known = items.find(s, h.source, h.ext_id)
        out.append({**h.__dict__, "item_id": known.id if known else None})
    return {"local": [items.card(s, i) for i in local], "results": out}


class AddIn(BaseModel):
    ext_id: str
    shelf: Shelf | None = None
    status: str | None = None
    started_on: date | None = None
    date_precision: Precision = "day"


@router.post("/{kind}/items")
async def add(kind: Kind, body: AddIn, s: Session = Depends(get_session)):
    require_kind(s, kind)
    item = await items.ensure(s, kind, body.ext_id)
    entry = items.library_entry(s, item)
    if body.shelf:
        entry.shelf = body.shelf
        s.add(entry)
    if body.status:
        run = items.new_run(s, item, date_precision=body.date_precision)
        transition(s, run, kind, body.status, endless=item.endless, when=body.started_on)
        if kind == "show":
            shows.derive(s, item, run)
    s.commit()
    return items.card(s, item)


# ---- library ----

@router.get("/{kind}/library")
def library(kind: Kind, status: list[str] | None = None, genre: list[str] | None = None,
            sort: Literal["recent", "rating", "year", "title"] = "recent", s: Session = Depends(get_session)):
    require_kind(s, kind)
    rows = s.exec(select(Item, LibraryEntry).join(LibraryEntry, col(LibraryEntry.item_id) == col(Item.id)).where(Item.kind == kind)).all()
    cards, counts = [], {"all": 0}
    for item, entry in rows:
        c = items.card(s, item, entry)
        key = c["status"] or "none"
        counts[key] = counts.get(key, 0) + 1
        counts["all"] += 1
        if (not status or key in status) and (not genre or set(genre) & set(item.genres)):
            c["_recent"] = _recent(s, item, entry)
            cards.append(c)
    keys = {"recent": lambda c: c["_recent"], "rating": lambda c: (c["my_rating"] or 0, c["_recent"]),
            "year": lambda c: (c["year"] or 0, c["title"]), "title": lambda c: c["title"].lower()}
    cards.sort(key=keys[sort], reverse=sort in ("recent", "rating", "year"))
    for c in cards:
        c.pop("_recent")
    genres = sorted({g for item, _ in rows for g in item.genres})
    return {"counts": counts, "items": cards, "genres": genres}


def _recent(s: Session, item: Item, entry: LibraryEntry) -> str:
    e = s.exec(select(Event).where(Event.item_id == item.id).order_by(col(Event.occurred_at).desc())).first()
    return items.utc(e.occurred_at if e else entry.added_at).isoformat()


@router.get("/shows/up-next")
def up_next(s: Session = Depends(get_session)):
    require_kind(s, "show")
    out = []
    for item in s.exec(select(Item).where(Item.kind == "show")):
        run = items.current_run(s, item.id)  # type: ignore[arg-type]
        if not run or run.status != "watching":
            continue
        nxt = shows.next_episode(s, item, run)
        if nxt:
            out.append({"item": items.card(s, item, run=run), "episode": shows.episode_out(nxt, set()),
                        "progress": run.progress, "last": (items.last_activity(s, run) or datetime.min.replace(tzinfo=UTC)).isoformat()})
    out.sort(key=lambda x: x["last"], reverse=True)
    return out


# ---- detail ----

@router.get("/items/{item_id}")
async def detail(item_id: int, s: Session = Depends(get_session)):
    item = _item(s, item_id)
    return _detail(s, item)


@router.post("/items/{item_id}/refresh")
async def refresh(item_id: int, s: Session = Depends(get_session)):
    item = _item(s, item_id)
    item = await items.refresh(s, item)
    if item.kind == "show" and (run := items.current_run(s, item.id)):  # type: ignore[arg-type]
        shows.derive(s, item, run)
        s.commit()
    return _detail(s, item)


def _detail(s: Session, item: Item) -> dict:
    run = items.current_run(s, item.id)  # type: ignore[arg-type]
    entry = s.get(LibraryEntry, item.id)
    people = s.exec(select(ItemPerson, Person).join(Person, col(Person.id) == col(ItemPerson.person_id))
                    .where(ItemPerson.item_id == item.id).order_by(col(ItemPerson.ord))).all()
    out = {
        **items.card(s, item, entry, run),
        "original_title": item.original_title, "overview": item.overview, "tagline": item.tagline, "tags": item.tags,
        "release_date": item.release_date.isoformat() if item.release_date else None, "details": item.details,
        "people": [{"name": p.name, "role": ip.role, "character": ip.character} for ip, p in people],
        "owned": entry.owned if entry else False, "platforms": entry.platforms if entry else [],
        "runs": [_run_out(r) for r in items.runs(s, item.id)],  # type: ignore[arg-type]
        "allowed": allowed(item.kind, run.status if run else None, item.endless),
        "suggest": _suggest(s, run),
    }
    if item.kind == "show":
        seen = shows.watched_ids(s, run)
        eps = shows.episodes(s, item.id)  # type: ignore[arg-type]
        seasons = s.exec(select(Season).where(Season.item_id == item.id).order_by(col(Season.number))).all()
        out["seasons"] = [{"number": se.number, "name": se.name, "premiere": se.premiere_date.isoformat() if se.premiere_date else None,
                           "episodes": [shows.episode_out(e, seen) for e in eps if e.season == se.number]} for se in seasons]
        nxt, upcoming = shows.next_episode(s, item, run), shows.upcoming_episode(s, item)
        out["next_episode"] = shows.episode_out(nxt, seen) if nxt else None
        out["upcoming_episode"] = shows.episode_out(upcoming, seen) if upcoming else None
    if item.kind == "game":
        out["time_left"] = games.time_left(item, run)
    return out


def _run_out(r: Run) -> dict:
    return {"id": r.id, "run_no": r.run_no, "status": r.status, "status_source": r.status_source,
            "started_on": r.started_on.isoformat() if r.started_on else None,
            "finished_on": r.finished_on.isoformat() if r.finished_on else None, "date_precision": r.date_precision,
            "progress": r.progress, "goal": r.goal, "variant": r.variant, "rating": r.rating, "review": r.review}


def _suggest(s: Session, run: Run | None) -> str | None:
    """Six weeks without activity on a show you're watching or a game you're playing: suggest pausing it.
    Never applied automatically (§5.3 'prompt, don't guess')."""
    if not run or run.status not in SUGGEST:
        return None
    last = items.last_activity(s, run)
    return SUGGEST[run.status] if last and datetime.now(UTC) - last > INACTIVE else None


# ---- library entry ----

class LibraryPatch(BaseModel):
    shelf: Shelf | Literal[""] | None = None
    owned: bool | None = None
    platforms: list[str] | None = None
    formats: list[str] | None = None
    priority: int | None = None
    endless: bool | None = None


@router.patch("/items/{item_id}")
def patch_item(item_id: int, body: LibraryPatch, s: Session = Depends(get_session)):
    item = _item(s, item_id)
    entry = items.library_entry(s, item)
    for f in ("owned", "platforms", "formats", "priority"):
        if (v := getattr(body, f)) is not None:
            setattr(entry, f, v)
    if body.shelf is not None:
        entry.shelf = body.shelf or None
    if body.endless is not None:
        item.endless = body.endless
        s.add(item)
    s.add(entry)
    s.commit()
    return _detail(s, item)


@router.delete("/items/{item_id}", status_code=204)
def remove(item_id: int, s: Session = Depends(get_session)):
    """Remove from your library: the entry, runs and history go; the cached metadata stays."""
    item = _item(s, item_id)
    s.exec(delete(Event).where(col(Event.item_id) == item.id))  # type: ignore[call-overload]
    s.exec(delete(Run).where(col(Run.item_id) == item.id))  # type: ignore[call-overload]
    if entry := s.get(LibraryEntry, item.id):
        s.delete(entry)
    s.commit()


# ---- runs ----

class RunIn(BaseModel):
    status: str
    started_on: date | None = None
    finished_on: date | None = None
    date_precision: Precision = "day"
    goal: Literal["main", "main_extras", "completionist"] | None = None
    variant: dict = Field(default_factory=dict)
    rating: float | None = Field(default=None, gt=0, le=10)


@router.post("/items/{item_id}/runs")
def start_run(item_id: int, body: RunIn, s: Session = Depends(get_session)):
    """A rewatch, reread or replay is a new run; earlier runs are never overwritten. Backfilled runs may start
    directly in a final state with partial dates."""
    item = _item(s, item_id)
    run = items.new_run(s, item, date_precision=body.date_precision, goal=body.goal, variant=body.variant,
                        rating=body.rating, started_on=body.started_on, finished_on=body.finished_on)
    transition(s, run, item.kind, body.status, endless=item.endless, when=body.finished_on or body.started_on)
    if item.kind == "show":
        shows.derive(s, item, run)
    s.commit()
    return _detail(s, item)


class RunPatch(BaseModel):
    rating: float | None = Field(default=None, gt=0, le=10)
    clear_rating: bool = False
    review: str | None = None
    goal: Literal["main", "main_extras", "completionist"] | None = None
    variant: dict | None = None
    started_on: date | None = None
    finished_on: date | None = None
    date_precision: Precision | None = None


@router.patch("/runs/{run_id}")
def patch_run(run_id: int, body: RunPatch, s: Session = Depends(get_session)):
    run, item = _run(s, run_id)
    for f in ("review", "goal", "variant", "started_on", "finished_on", "date_precision"):
        if (v := getattr(body, f)) is not None:
            setattr(run, f, v)
    if body.rating is not None or body.clear_rating:
        run.rating = None if body.clear_rating else body.rating
        s.add(Event(item_id=item.id, run_id=run.id, kind="rating", payload={"rating": run.rating}))  # type: ignore[arg-type]
    run.updated_at = datetime.now(UTC)
    s.add(run)
    s.commit()
    return _detail(s, item)


class StatusIn(BaseModel):
    status: str


@router.patch("/runs/{run_id}/status")
def set_status(run_id: int, body: StatusIn, s: Session = Depends(get_session)):
    run, item = _run(s, run_id)
    transition(s, run, item.kind, body.status, endless=item.endless)
    if item.kind == "show" and body.status not in STICKY:
        shows.derive(s, item, run)  # resuming a paused show lands on its real derived state
    s.commit()
    return _detail(s, item)


@router.post("/items/{item_id}/status")
def set_item_status(item_id: int, body: StatusIn, s: Session = Depends(get_session)):
    """The status control on the detail page: changes the current run, starting the first one if needed."""
    item = _item(s, item_id)
    run = items.current_run(s, item.id) or items.new_run(s, item)  # type: ignore[arg-type]
    transition(s, run, item.kind, body.status, endless=item.endless)
    if item.kind == "show" and body.status not in STICKY:
        shows.derive(s, item, run)
    s.commit()
    return _detail(s, item)


@router.delete("/runs/{run_id}", status_code=204)
def delete_run(run_id: int, s: Session = Depends(get_session)):
    run, _ = _run(s, run_id)
    s.exec(delete(Event).where(col(Event.run_id) == run.id))  # type: ignore[call-overload]
    s.delete(run)
    s.commit()


class ProgressIn(BaseModel):
    unit: Literal["page", "percent", "minutes"] | None = None  # books
    current: float | None = Field(default=None, ge=0)
    total: float | None = Field(default=None, gt=0)
    hours: float | None = Field(default=None, ge=0)  # games: total hours so far
    percent: float | None = Field(default=None, ge=0, le=100)


@router.post("/runs/{run_id}/progress")
def progress(run_id: int, body: ProgressIn, s: Session = Depends(get_session)):
    run, item = _run(s, run_id)
    if item.kind == "book":
        books.update_progress(s, item, run, body.unit, body.current, body.total)
    elif item.kind == "game":
        games.log_hours(s, item, run, body.hours, body.percent)
    else:
        raise HTTPException(422, "Shows track progress through episodes")
    s.commit()
    return _detail(s, item)


# ---- episodes ----

class EpisodesIn(BaseModel):
    episode_ids: list[int] = Field(default_factory=list)
    season: int | None = None
    watched: bool = True


@router.post("/items/{item_id}/episodes")
def tick(item_id: int, body: EpisodesIn, s: Session = Depends(get_session)):
    item = _item(s, item_id)
    if item.kind != "show":
        raise HTTPException(422, "Only shows have episodes")
    ids = list(body.episode_ids)
    if body.season is not None:  # mark the whole season: every aired episode
        ids += [e.id for e in shows.episodes(s, item.id) if e.season == body.season and (shows.aired(e) or not body.watched)]  # type: ignore[arg-type, misc]
    shows.set_watched(s, item, ids, body.watched)
    return _detail(s, item)
