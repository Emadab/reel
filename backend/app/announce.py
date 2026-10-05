"""Announcement jobs (REEL_EXPANSION Phase 5) and the diff engine that turns provider changes into notifications.
Every job is idempotent: notifications are keyed (dedupe_key), so running a job twice creates nothing new."""
from datetime import UTC, date, datetime, timedelta

from sqlmodel import Session, col, select

from . import items, notify, shows, tmdb
from .models import Movie, WatchlistItem
from .models_media import Episode, ExternalId, Follow, Item, LibraryEntry, Notification, SyncState
from .providers import hardcover, openlibrary, rawg, tvmaze
from .providers.http import ProviderUnavailable
from .status import STICKY

FULL_REFRESH = timedelta(days=30)  # TVmaze's feed covers a month; older than that, refresh everything


def now() -> datetime:
    return datetime.now(UTC)


def state(s: Session, provider: str, job: str) -> SyncState:
    row = s.get(SyncState, (provider, job))
    if not row:
        row = SyncState(provider=provider, job=job)
        s.add(row)
        s.flush()
    return row


def muted(s: Session, item_id: int) -> bool:
    f = s.exec(select(Follow).where(Follow.target_kind == "item", Follow.target_id == str(item_id))).first()
    return bool(f and not f.notify)


def followed(s: Session, kind: str) -> list[tuple[Item, LibraryEntry]]:
    """Items in your library you'd want news about: not muted, not 'not interested', and not paused/dropped."""
    out = []
    rows = s.exec(select(Item, LibraryEntry).join(LibraryEntry, col(LibraryEntry.item_id) == col(Item.id)).where(Item.kind == kind)).all()
    for item, entry in rows:
        run = items.current_run(s, item.id)  # type: ignore[arg-type]
        if entry.shelf == "not_interested" or (run and run.status in STICKY) or muted(s, item.id):  # type: ignore[arg-type]
            continue
        out.append((item, entry))
    return out


def _path(item: Item) -> str:
    return f"/{item.kind}s/{item.id}"


# ---- shows ----

def snapshot(s: Session, item: Item) -> dict:
    eps = shows.episodes(s, item.id)  # type: ignore[arg-type]
    return {"status": item.status, "seasons": sorted({e.season for e in eps if e.season > 0}),
            "episodes": {(e.season, e.number): (e.id, items.utc(e.airstamp_utc) if e.airstamp_utc else None) for e in eps if e.season > 0}}


def diff_show(s: Session, item: Item, before: dict, after: dict) -> int:
    """New season, moved air date, renewal, cancellation/ending → notifications. Returns how many were created."""
    made = 0
    path = _path(item)
    new_seasons = [n for n in after["seasons"] if n not in before["seasons"]]
    for n in new_seasons:
        made += bool(notify.add(s, f"season:{item.id}:{n}:announced", "season_announced", item.title, f"Season {n} is announced", path, item.id))
    if before["status"] in ("ended", "canceled") and after["status"] in ("returning", "upcoming"):
        made += bool(notify.add(s, f"show:{item.id}:renewed:{max(after['seasons'], default=0)}", "renewed", item.title, "It's back: renewed", path, item.id))
    if after["status"] != before["status"] and after["status"] in ("canceled", "ended"):
        word = "canceled" if after["status"] == "canceled" else "ended"
        made += bool(notify.add(s, f"show:{item.id}:{word}", word, item.title, f"The show has {word}", path, item.id))
    for key, (eid, stamp) in after["episodes"].items():
        old = before["episodes"].get(key)
        if old and old[1] and stamp and old[1].date() != stamp.date() and stamp > now():
            made += bool(notify.add(s, f"episode:{eid}:moved:{stamp.date()}", "date_moved", item.title,
                                    f"S{key[0]} · E{key[1]} moved to {stamp:%b} {stamp.day}",
                                    path, item.id, eid))
    return made


async def show_updates(s: Session) -> int:
    """TVmaze's update feed since the last run, then refetch the followed shows that changed and diff them."""
    st = state(s, "tvmaze", "show_updates")
    last = items.utc(st.last_run_at) if st.last_run_at else None
    changed: set[str] | None = None
    if last and now() - last < FULL_REFRESH:
        try:
            changed = await tvmaze.changed_since(last)
        except ProviderUnavailable:
            return 0
    made = 0
    for item, _ in followed(s, "show"):
        tv = s.exec(select(ExternalId).where(ExternalId.item_id == item.id, ExternalId.source == "tvmaze")).first()
        if changed is not None and tv and tv.ext_id not in changed and not items.is_stale(item):
            continue
        before = snapshot(s, item)
        try:
            item = await items.refresh(s, item)
        except ProviderUnavailable:
            continue
        made += diff_show(s, item, before, snapshot(s, item))
        s.commit()  # one writer at a time in SQLite: release before the next provider call caches
    shows.rederive_all(s)
    st.last_run_at = now()
    s.add(st)
    s.commit()
    return made


def airing(s: Session, at: datetime | None = None) -> int:
    """Episodes of followed shows that aired since the last check. Same-day episodes collapse; shows you
    marked high priority also go to the desktop and phone."""
    at = at or now()
    st = state(s, "reel", "airing")
    since = items.utc(st.last_run_at) if st.last_run_at else at - timedelta(days=1)
    made = 0
    for item, entry in followed(s, "show"):
        eps = s.exec(select(Episode).where(Episode.item_id == item.id, Episode.is_special == False,  # noqa: E712
                                           col(Episode.airstamp_utc).is_not(None))).all()
        for e in eps:
            stamp = items.utc(e.airstamp_utc)  # type: ignore[arg-type]
            if since < stamp <= at:
                notify.add_aired(s, item.id, item.title, _path(item), {"id": e.id, "season": e.season, "number": e.number},  # type: ignore[arg-type]
                                 stamp.date().isoformat(), push=entry.priority > 0)
                made += 1
    shows.rederive_all(s)
    st.last_run_at = at
    s.add(st)
    s.commit()
    return made


# ---- movies: digital releases of watchlisted films (read-only use of the movie tables) ----

async def movie_releases(s: Session, today: date | None = None) -> int:
    today = today or date.today()
    made = 0
    for w in s.exec(select(WatchlistItem)).all():
        try:
            d = await tmdb.get(f"/movie/{w.tmdb_id}/release_dates")
        except Exception:
            continue
        digital = [r["release_date"][:10] for c in d.get("results", []) for r in c.get("release_dates", []) if r.get("type") == 4 and r.get("release_date")]
        if digital and min(digital) <= today.isoformat() and min(digital) >= (today - timedelta(days=60)).isoformat():
            m = s.get(Movie, w.tmdb_id)
            made += bool(notify.add(s, f"movie:{w.tmdb_id}:digital_release", "digital_release", m.title if m else "A film on your watchlist",
                                    "Now available to stream or buy", f"/film/{w.tmdb_id}"))
            s.commit()
    state(s, "tmdb", "movie_releases").last_run_at = now()
    s.commit()
    return made


# ---- books: followed authors and series ----

async def book_follows(s: Session) -> int:
    made = 0
    for f in s.exec(select(Follow).where(col(Follow.target_kind).in_(["author", "series"]), Follow.notify == True)).all():  # noqa: E712
        st = state(s, "books", f"{f.target_kind}:{f.target_id}")
        try:
            works = await (openlibrary.author_works(f.target_id) if f.target_kind == "author" else hardcover.series_books(f.target_id))
        except ProviderUnavailable:
            continue
        seen = set(st.cursor.get("seen", []))
        released = set(st.cursor.get("released", []))
        first = st.last_run_at is None  # the first run only learns what exists
        for w in works:
            if w.ext_id not in seen and not first:
                made += bool(notify.add(s, f"book:{f.target_kind}:{f.target_id}:{w.ext_id}:announced", "book_announced", w.title,
                                        f"New from {f.name or 'an author you follow'}", None))
            if f.target_kind == "series" and w.subtitle and w.subtitle[:10] <= date.today().isoformat() and w.ext_id not in released:
                if not first:
                    made += bool(notify.add(s, f"book:{w.ext_id}:released", "released", w.title, f"Out now · {f.name or 'series'}", None))
                released.add(w.ext_id)
            seen.add(w.ext_id)
        st.cursor = {"seen": sorted(seen), "released": sorted(released)}
        st.last_run_at = now()
        s.add(st)
        s.commit()
    return made


# ---- games: wishlist releases and date changes, DLC for games you've beaten ----

async def game_releases(s: Session, today: date | None = None) -> int:
    today = today or date.today()
    made = 0
    for item, entry in followed(s, "game"):
        run = items.current_run(s, item.id)  # type: ignore[arg-type]
        beaten = bool(run and run.status in ("beaten", "completed"))
        if entry.shelf != "wishlist" and not beaten:
            continue
        before_date, before_dlc = item.release_date, {d["rawg"] for d in item.details.get("dlc", [])}
        try:
            rawg.api.forget(f"/games/{items.primary_id(s, item)}")
            item = await items.refresh(s, item)
        except ProviderUnavailable:
            continue
        path = _path(item)
        if entry.shelf == "wishlist" and item.release_date:
            if before_date and item.release_date != before_date and item.release_date > today:
                made += bool(notify.add(s, f"game:{item.id}:date:{item.release_date}", "date_moved", item.title,
                                        f"Release moved to {item.release_date:%b} {item.release_date.day}, {item.release_date.year}", path, item.id))
            if item.release_date <= today and (today - item.release_date).days <= 30:
                made += bool(notify.add(s, f"game:{item.id}:released", "released", item.title, "Out now", path, item.id))
        if beaten:
            for d in item.details.get("dlc", []):
                if d["rawg"] not in before_dlc:
                    made += bool(notify.add(s, f"dlc:{d['rawg']}:announced", "dlc", item.title, f"New expansion: {d['name']}", path, item.id))
        s.commit()
    state(s, "rawg", "game_releases").last_run_at = now()
    s.commit()
    return made


def unseen_count(s: Session) -> int:
    return len(s.exec(select(Notification.id).where(col(Notification.seen_at).is_(None))).all())
