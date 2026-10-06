"""TV series: fetch (TMDB metadata + TVmaze airstamps), episode ticks, state derivation and up next.

Derived states (§5.3): watching while aired regular episodes remain unwatched; caught_up when all aired
episodes are watched and the show continues; completed when it has ended or been canceled. Specials
(season 0) never count. Sticky states (on_hold, dropped) are never overridden."""
import asyncio
from datetime import UTC, date, datetime, time

from fastapi import HTTPException
from sqlmodel import Session, col, select

from . import items, tmdb
from .cards import normalize
from .models_media import Episode, Event, Item, Run
from .providers import tvmaze, wikidata
from .providers.base import ItemData, SearchHit
from .providers.http import ProviderUnavailable
from .providers.tmdb_tv import _hit
from .providers.tmdb_tv import provider as tmdb_tv
from .status import FINISHED, STICKY, transition


async def collection(tmdb_id: str, title: str) -> dict | None:
    """The shows it belongs with (Breaking Bad and Better Call Saul, every Star Trek), oldest first, like a
    film's collection. None when it stands alone."""
    name, ids = await wikidata.related_shows(tmdb_id)
    if len(ids) < 2:
        return None
    found = await asyncio.gather(*(tmdb.get(f"/tv/{i}") for i in ids), return_exceptions=True)
    parts = [_hit(d).__dict__ for d in found if isinstance(d, dict)]
    parts.sort(key=lambda h: h["year"] or 9999)
    return {"name": name or title, "parts": parts} if len(parts) > 1 else None


async def ensure_collection(s: Session, item: Item) -> None:
    """Look up a show's collection once (shows cached before collections existed), and cache its other
    shows the way suggestions are cached, so each one opens like any other show."""
    from .recommender.media import _light  # late import: the recommender imports this module

    if "collection" not in item.details:
        try:
            col = await collection(items.primary_id(s, item), item.title)
        except HTTPException:
            return  # offline or a provider is down: try again next time the page opens
        item.details = {**item.details, "collection": col}
        s.add(item)
        s.commit()
    for h in (item.details["collection"] or {}).get("parts", []):
        await _light(s, "show", SearchHit(**h))


def collection_out(s: Session, item: Item) -> dict | None:
    col = item.details.get("collection")
    if not col:
        return None
    shown = [x for h in col["parts"] if (x := items.find(s, h["source"], h["ext_id"]))]
    return {"name": col["name"], "items": [items.card(s, x) for x in shown]} if len(shown) > 1 else None


async def fetch_show(tmdb_id: str) -> ItemData | None:
    data = await tmdb_tv.fetch(tmdb_id)
    if data is not None:
        try:
            data.details["collection"] = await collection(tmdb_id, data.title)
        except HTTPException:
            pass  # keeps the collection it had
    if data is None or not (imdb := data.external_ids.get("imdb")):
        return data
    try:
        found = await tvmaze.lookup_imdb(imdb)
        if not found:
            return data
        exact = {(e.season, e.number): e for e in await tvmaze.episodes(found["tvmaze_id"]) if e.season > 0}
    except ProviderUnavailable:
        return data  # TMDB's dates are good enough until TVmaze is reachable
    data.external_ids["tvmaze"] = found["tvmaze_id"]
    for e in data.episodes:
        if (m := exact.get((e.season, e.number))) and m.airstamp_utc:
            e.airstamp_utc = m.airstamp_utc
            e.provider_ids.update(m.provider_ids)
    return data


def now() -> datetime:
    return datetime.now(UTC)


def aired(e: Episode, at: datetime | None = None) -> bool:
    return e.airstamp_utc is not None and items.utc(e.airstamp_utc) <= (at or now())


def episodes(s: Session, item_id: int) -> list[Episode]:
    return list(s.exec(select(Episode).where(Episode.item_id == item_id).order_by(col(Episode.season), col(Episode.number))))


def watched_events(s: Session, run: Run | None) -> dict[int, Event]:
    if not run:
        return {}
    return {e.episode_id: e for e in s.exec(select(Event).where(Event.run_id == run.id, Event.kind == "episode_watched")) if e.episode_id}


def watched_ids(s: Session, run: Run | None) -> set[int]:
    return set(watched_events(s, run))


def event_time(d: date | None, precision: str) -> datetime:
    """When an episode was watched, as stored: noon UTC on the normalized date (no timezone can shift it to
    another day); unknown is 0001-01-01, like movie watches; no date means now."""
    if precision == "unknown":
        return datetime.combine(normalize(date.today(), "unknown"), time(12), UTC)
    return datetime.combine(normalize(d, precision), time(12), UTC) if d else now()


def derive(s: Session, item: Item, run: Run, at: datetime | None = None) -> None:
    """Recompute progress and the derived state. Caller commits."""
    regular = [e for e in episodes(s, item.id) if not e.is_special]  # type: ignore[arg-type]
    on_air = [e for e in regular if aired(e, at)]
    seen = watched_ids(s, run)
    n_seen = sum(1 for e in on_air if e.id in seen)
    run.progress = {"watched": n_seen, "aired": len(on_air), "total": len(regular)}
    s.add(run)
    if run.status in STICKY or (run.status is None and n_seen == 0):
        return
    if n_seen < len(on_air):
        target = "watching"
    else:
        target = "completed" if item.status in ("ended", "canceled") else "caught_up"
    if not transition(s, run, "show", target, source="derived"):
        # no direct edge (completed → watching after a revival airs): go through caught_up
        if transition(s, run, "show", "caught_up", source="derived"):
            transition(s, run, "show", target, source="derived")


COARSER = {"day": 0, "month": 1, "year": 2, "unknown": 3}


def sync_dates(s: Session, run: Run) -> None:
    """A show's run starts with its first watched episode and, once caught up or completed, finishes with its
    last, at the coarser of the two precisions. Episodes with unknown dates only count when nothing is known."""
    evs = list(watched_events(s, run).values())
    if not evs:
        return
    done = run.status in ("completed", "caught_up")
    known = [e for e in evs if e.date_precision != "unknown"]
    if not known:
        run.date_precision, run.started_on = "unknown", date.min
        run.finished_on = date.min if done else None
    else:
        first = min(known, key=lambda e: items.utc(e.occurred_at))
        last = max(known, key=lambda e: items.utc(e.occurred_at))
        p = max(first.date_precision, last.date_precision, key=lambda x: COARSER.get(x, 0))
        run.date_precision = p
        run.started_on = normalize(items.utc(first.occurred_at).date(), p)
        run.finished_on = normalize(items.utc(last.occurred_at).date(), p) if done else None
    s.add(run)


def active_run(s: Session, item: Item) -> Run:
    """The run episode ticks go to; a show you've never ticked gets its first run here."""
    run = items.current_run(s, item.id)  # type: ignore[arg-type]
    return run or items.new_run(s, item)


def set_watched(s: Session, item: Item, episode_ids: list[int], watched: bool, when: datetime | None = None,
                precision: str = "day", run: Run | None = None) -> Run:
    """Tick or untick episodes. With `when`, an episode that's already ticked gets its date changed."""
    run = run or active_run(s, item)
    eps = {e.id: e for e in episodes(s, item.id)}  # type: ignore[arg-type]
    if any(i not in eps for i in episode_ids):
        raise HTTPException(404, "Episode not found")
    seen = watched_events(s, run)
    for i in episode_ids:
        if watched and i in seen and when:
            seen[i].occurred_at, seen[i].date_precision = when, precision
            s.add(seen[i])
        elif watched and i not in seen:
            if not eps[i].is_special and not aired(eps[i]):
                continue  # can't have watched what hasn't aired
            s.add(Event(item_id=item.id, run_id=run.id, episode_id=i, kind="episode_watched",  # type: ignore[arg-type]
                        occurred_at=when or now(), date_precision=precision, payload={"season": eps[i].season, "number": eps[i].number}))
        elif not watched and i in seen:
            # an untick undoes a mistaken tick rather than recording an "unwatched" fact
            for ev in s.exec(select(Event).where(Event.run_id == run.id, Event.episode_id == i, Event.kind == "episode_watched")):
                s.delete(ev)
    s.flush()
    derive(s, item, run)
    sync_dates(s, run)
    s.commit()
    return run


def next_episode(s: Session, item: Item, run: Run | None) -> Episode | None:
    seen = watched_ids(s, run)
    return next((e for e in episodes(s, item.id) if not e.is_special and aired(e) and e.id not in seen), None)  # type: ignore[arg-type]


def upcoming_episode(s: Session, item: Item) -> Episode | None:
    return next((e for e in episodes(s, item.id) if not e.is_special and e.airstamp_utc and not aired(e)), None)  # type: ignore[arg-type]


def episode_out(e: Episode, seen: dict[int, Event]) -> dict:
    ev = seen.get(e.id)  # type: ignore[arg-type]
    return {"id": e.id, "season": e.season, "number": e.number, "title": e.title, "overview": e.overview,
            "airstamp": items.utc(e.airstamp_utc).isoformat() if e.airstamp_utc else None, "aired": aired(e),
            "runtime": e.runtime_min, "still": e.still_path, "special": e.is_special, "watched": ev is not None,
            "watched_on": items.utc(ev.occurred_at).date().isoformat() if ev else None,
            "watched_precision": ev.date_precision if ev else None}


def add_history(s: Session, item: Item, upto_season: int | None, started_on: date | None, finished_on: date | None,
                precision: str, rating: float | None) -> Run:
    """Backfill a show watched long ago in one go: every aired episode (or up to a season) as watched on the
    finish date. Fills in the current run when it's partly watched; a run that already has all of it means
    this is another time through, so it becomes a new run."""
    target = [e for e in episodes(s, item.id) if not e.is_special and aired(e) and (upto_season is None or e.season <= upto_season)]  # type: ignore[arg-type]
    if not target:
        raise HTTPException(422, "No aired episodes to add")
    run = items.current_run(s, item.id)  # type: ignore[arg-type]
    seen = watched_ids(s, run)
    if run is None or all(e.id in seen for e in target):
        run, seen = items.new_run(s, item), set()
    fresh = not seen
    at = event_time(finished_on or started_on, precision)
    set_watched(s, item, [e.id for e in target if e.id not in seen], True, at, precision, run=run)  # type: ignore[misc]
    if fresh:  # the dates describe this run; a partly watched run keeps its own
        run.date_precision = precision
        run.started_on = normalize(started_on or finished_on or date.min, precision) if (started_on or finished_on or precision == "unknown") else None
        run.finished_on = normalize(finished_on or started_on or date.min, precision) if run.status in FINISHED or run.status == "caught_up" else None
    if rating is not None:
        run.rating = rating
    s.add(run)
    s.commit()
    return run


def rederive_all(s: Session) -> int:
    """Time passing airs episodes: re-derive every show run that isn't sticky (startup + scheduler)."""
    changed = 0
    for item in s.exec(select(Item).where(Item.kind == "show")):
        run = items.current_run(s, item.id)  # type: ignore[arg-type]
        if run and run.status not in STICKY:
            before = run.status
            derive(s, item, run)
            changed += run.status != before
    s.commit()
    return changed
