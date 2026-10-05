"""Shows, books and games: ingest from providers (deduplicated through external ids), library entries,
runs, and the card shape every list returns."""
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlmodel import Session, col, delete, select

from . import jobs, media
from .models_media import Episode, Event, ExternalId, Item, ItemPerson, LibraryEntry, Person, Run, Season
from .providers import PRIMARY
from .providers.base import ItemData, Kind
from .status import FINISHED, STICKY

STALE = timedelta(days=30)
SUBTITLE = {"show": "networks", "book": "authors", "game": "platforms"}
PRIMARY_SOURCE = {"show": "tmdb_tv", "book": "openlibrary", "game": "rawg"}
ENDED = FINISHED | {"dropped", "abandoned", "did_not_finish", "retired"}


def utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def find(s: Session, source: str, ext_id: str) -> Item | None:
    row = s.get(ExternalId, (source, ext_id))
    return s.get(Item, row.item_id) if row else None


def get_item(s: Session, item_id: int, kind: str | None = None) -> Item:
    item = s.get(Item, item_id)
    if not item or (kind and item.kind != kind):
        raise HTTPException(404, "Not found")
    return item


async def fetch_data(kind: str, ext_id: str) -> ItemData:
    if kind == "show":
        from .shows import fetch_show  # TMDB TV + TVmaze airstamps

        data = await fetch_show(ext_id)
    elif kind == "book":
        from .books import fetch_book  # Open Library + Hardcover + Google Books

        data = await fetch_book(ext_id)
    else:
        data = await PRIMARY[kind].fetch(ext_id, kind)  # type: ignore[index, arg-type]
    if data is None:
        raise HTTPException(404, f"Not found on {PRIMARY[kind].name}")  # type: ignore[index]
    return data


async def ensure(s: Session, kind: Kind, ext_id: str) -> Item:
    """The local item for a provider id, fetching it once."""
    if item := find(s, PRIMARY_SOURCE[kind], ext_id):
        return item
    data = await fetch_data(kind, ext_id)
    for src, ext in data.external_ids.items():  # already known under another id (e.g. the same ISBN)
        if ext and (item := find(s, src, ext)):
            return item
    return await upsert(s, data)


def primary_id(s: Session, item: Item) -> str:
    row = s.exec(select(ExternalId).where(ExternalId.item_id == item.id, ExternalId.source == PRIMARY_SOURCE[item.kind])).first()
    if not row:
        raise HTTPException(409, "This item has no provider id to refresh from")
    return row.ext_id


async def refresh(s: Session, item: Item) -> Item:
    return await upsert(s, await fetch_data(item.kind, primary_id(s, item)), item)


def is_stale(item: Item) -> bool:
    return datetime.now(UTC) - utc(item.refreshed_at) > STALE


async def upsert(s: Session, d: ItemData, item: Item | None = None) -> Item:
    item = item or Item(kind=d.kind, title=d.title)
    for f in ("title", "original_title", "year", "release_date", "overview", "tagline", "genres", "tags", "status"):
        setattr(item, f, getattr(d, f))
    item.endless = item.endless or d.endless  # the user may have set it; a refresh never unsets it
    item.details = {k: v for k, v in {**item.details, **d.details}.items() if k != "light"}
    item.details["recs"] = [h.__dict__ for h in d.recommendations[:20]]
    if shots := d.details.get("screenshots"):  # stored locally: the UI never hot-links provider images
        item.details["screenshots"] = [u for u in [await media.store_image(f"{d.kind}-shot", s) for s in shots[:6]] if u]
    cover = await media.store_image(d.kind, d.cover_url)
    if cover and cover != item.cover_path:
        item.cover_path = cover
        item.palette, item.dominant = media.palette_for(cover)
    item.backdrop_path = await media.store_image(f"{d.kind}-backdrop", d.backdrop_url) or item.backdrop_path
    item.refreshed_at = datetime.now(UTC)
    item.embedding = None  # re-embed with the new text
    s.add(item)
    s.flush()
    for src, ext in d.external_ids.items():
        if ext and not s.get(ExternalId, (src, ext)):
            s.add(ExternalId(source=src, ext_id=ext, item_id=item.id))  # type: ignore[arg-type]
    _people(s, item, d)
    _seasons(s, item, d)
    s.commit()
    s.refresh(item)
    if d.kind == "show":
        item_id = item.id
        jobs.enqueue(f"stills:{item_id}", lambda: _stills_job(item_id))  # type: ignore[arg-type]
    return item


def _people(s: Session, item: Item, d: ItemData) -> None:
    s.exec(delete(ItemPerson).where(col(ItemPerson.item_id) == item.id))  # type: ignore[call-overload]
    for i, p in enumerate(d.people):
        key = f"{d.kind}:{p.role}:{p.ext_id}" if p.ext_id else None
        person = None
        if key:
            person = next((x for x in s.exec(select(Person).where(Person.name == p.name)) if x.external_ids.get("key") == key), None)
        if not person:
            person = Person(name=p.name, external_ids={"key": key} if key else {})
            s.add(person)
            s.flush()
        s.add(ItemPerson(item_id=item.id, person_id=person.id, role=p.role, character=p.character, ord=i))  # type: ignore[arg-type]


def _seasons(s: Session, item: Item, d: ItemData) -> None:
    """Upsert seasons and episodes by number so episode ids (referenced by watch events) stay stable."""
    have = {x.number: x for x in s.exec(select(Season).where(Season.item_id == item.id))}
    for sd in d.seasons:
        row = have.get(sd.number) or Season(item_id=item.id, number=sd.number)  # type: ignore[arg-type]
        row.name, row.premiere_date, row.episode_count = sd.name, sd.premiere_date, sd.episode_count
        s.add(row)
    eps = {(e.season, e.number): e for e in s.exec(select(Episode).where(Episode.item_id == item.id))}
    for ed in d.episodes:
        row = eps.get((ed.season, ed.number)) or Episode(item_id=item.id, season=ed.season, number=ed.number)  # type: ignore[arg-type]
        row.title, row.overview, row.airstamp_utc, row.runtime_min = ed.title, ed.overview, ed.airstamp_utc, ed.runtime_min
        row.is_special = ed.is_special
        row.provider_ids = {**row.provider_ids, **ed.provider_ids, **({"still_url": ed.still_url} if ed.still_url else {})}
        s.add(row)


async def _stills_job(item_id: int) -> None:
    from . import db

    with Session(db.engine) as s:
        for e in s.exec(select(Episode).where(Episode.item_id == item_id, col(Episode.still_path).is_(None))):
            if url := e.provider_ids.get("still_url"):
                e.still_path = await media.store_image("episode", url)
                s.add(e)
        s.commit()


# ---- library, runs ----

def library_entry(s: Session, item: Item) -> LibraryEntry:
    entry = s.get(LibraryEntry, item.id)
    if not entry:
        entry = LibraryEntry(item_id=item.id)  # type: ignore[arg-type]
        s.add(entry)
        s.flush()
    return entry


def runs(s: Session, item_id: int) -> list[Run]:
    return list(s.exec(select(Run).where(Run.item_id == item_id).order_by(col(Run.run_no))))


def current_run(s: Session, item_id: int) -> Run | None:
    """The active run if any, else the latest."""
    rs = runs(s, item_id)
    active = [r for r in rs if r.status and r.status not in ENDED]
    return (active or rs or [None])[-1]


def new_run(s: Session, item: Item, **fields) -> Run:
    n = max((r.run_no for r in runs(s, item.id)), default=0) + 1  # type: ignore[arg-type]
    run = Run(item_id=item.id, run_no=n, **fields)  # type: ignore[arg-type]
    s.add(run)
    s.flush()
    entry = library_entry(s, item)
    if entry.shelf in ("wishlist", "backlog"):
        entry.shelf = None  # starting something takes it off the wishlist/backlog
        s.add(entry)
    return run


def displayed_status(run: Run | None, entry: LibraryEntry | None) -> str | None:
    """Active run's status, else latest run's status, else the shelf (§5.1)."""
    return (run.status if run and run.status else None) or (entry.shelf if entry else None)


def last_activity(s: Session, run: Run) -> datetime | None:
    e = s.exec(select(Event).where(Event.run_id == run.id).order_by(col(Event.occurred_at).desc())).first()
    return utc(e.occurred_at) if e else None


def card(s: Session, item: Item, entry: LibraryEntry | None = None, run: Run | None = None) -> dict:
    entry = entry or s.get(LibraryEntry, item.id)
    run = run or current_run(s, item.id)  # type: ignore[arg-type]
    sub = item.details.get(SUBTITLE[item.kind]) or []
    rated = [r.rating for r in runs(s, item.id) if r.rating is not None]  # type: ignore[arg-type]
    return {
        "id": item.id, "kind": item.kind, "title": item.title, "year": item.year,
        "subtitle": ", ".join(sub[:2]) if isinstance(sub, list) else sub,
        "poster": item.cover_path, "poster_sm": item.cover_path, "backdrop": item.backdrop_path,
        "palette": item.palette, "poster_art": media.poster_art(item.id or 0, item.palette, item.dominant),
        "genres": item.genres, "item_status": item.status, "endless": item.endless,
        "status": displayed_status(run, entry), "shelf": entry.shelf if entry else None, "in_library": entry is not None,
        "my_rating": rated[-1] if rated else None, "progress": run.progress if run else {},
        "run_no": run.run_no if run else 0, "sticky": bool(run and run.status in STICKY),
        "added_at": entry.added_at.isoformat() if entry else None,
    }
