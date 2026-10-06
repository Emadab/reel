"""Games: hours and percent logging, and the time-left estimate.
RAWG gives one average playtime; goals scale it (main 1x, main + extras 1.6x, completionist 2.6x)."""
import asyncio

from sqlmodel import Session, col, select

from . import db, items, jobs, media
from .config import settings
from .models_media import Event, ExternalId, Item, Run
from .providers import rawg
from .providers.http import ProviderUnavailable
from .status import transition

# ponytail: fixed multipliers stand in for IGDB's per-goal time-to-beat; use real figures if IGDB is added
GOAL_FACTOR = {"main": 1.0, "main_extras": 1.6, "completionist": 2.6}


def estimate(item: Item, goal: str | None) -> float | None:
    avg = item.details.get("playtime_hours")
    return round(avg * GOAL_FACTOR.get(goal or "main", 1.0), 1) if avg and not item.endless else None


def time_left(item: Item, run: Run | None) -> float | None:
    est = estimate(item, run.goal if run else None)
    if est is None:
        return None
    played = (run.progress.get("hours") or 0) if run else 0
    return round(max(est - played, 0), 1)


def log_hours(s: Session, item: Item, run: Run, hours: float | None, percent: float | None) -> None:
    p = dict(run.progress)
    before = p.get("hours") or 0
    if hours is not None:
        p["hours"] = hours
    if percent is not None:
        p["percent"] = percent
    run.progress = p
    s.add(run)
    s.add(Event(item_id=item.id, run_id=run.id, kind="session",  # type: ignore[arg-type]
                payload={"hours": p.get("hours"), "delta": round((p.get("hours") or 0) - before, 2), "percent": p.get("percent")}))
    if run.status is None and (p.get("hours") or 0) > before:
        transition(s, run, "game", "playing", source="derived")  # derived: never overrides a sticky run


async def fill_box_art() -> None:
    """Box art for every game that hasn't had it tried: your library, suggestions and series members all start
    with RAWG's screenshot. Runs at startup and after anything caches new games; each game is tried once."""
    with Session(db.engine) as s:
        rows = [(i, e) for i, e in s.exec(select(Item, ExternalId).join(ExternalId, col(ExternalId.item_id) == col(Item.id))
                                        .where(Item.kind == "game", ExternalId.source == "rawg")) if not i.details.get("box_art_tried")]
        for n, (item, ext) in enumerate(rows):
            jobs.progress("box-art", n + 1, len(rows))
            try:
                d = await rawg.api.get(f"/games/{ext.ext_id}", rawg._key())
                url = d and await rawg.box_art(d.get("name") or item.title, item.year, ext.ext_id, d)
            except ProviderUnavailable:
                return  # offline or throttled: the rest wait for the next run
            if url and (cover := await media.store_image("game", url)) and cover != item.cover_path:
                item.cover_path = cover
                item.palette, item.dominant = await asyncio.to_thread(media.palette_for, cover)
            item.details = {**item.details, "box_art_tried": True}
            s.add(item)
            s.commit()


def request_box_art() -> None:
    if settings.rawg_key:
        jobs.enqueue("box-art", fill_box_art)


def series_name(title: str, titles: list[str]) -> str | None:
    """What a series is called: the words its titles start with (The Witcher, Mass Effect, Grand Theft Auto),
    among the titles that start like this game's (a mod or spin-off with another name doesn't count)."""
    norm = lambda t: [w.strip(":-–,.").lower() for w in t.split()]
    head = next((w for w in norm(title) if w != "the"), "")
    split = [norm(t) for t in titles if head in norm(t)[:2]]
    n = 0
    while len(split) > 1 and all(len(w) > n for w in split) and len({w[n] for w in split}) == 1:
        n += 1
    words = [w.strip(":-–,.") for w in title.split()[:n]]
    return " ".join(words) if words and words != ["The"] else None


async def ensure_collection(s: Session, item: Item) -> bool:
    """The other games in its series (RAWG), like a show's collection. The list is looked up once (a game that
    stands alone stores None); its games are cached and given box art in the background. True while that runs."""
    if "collection" not in item.details:
        from .providers.base import SearchHit

        ext = s.exec(select(ExternalId).where(ExternalId.item_id == item.id, ExternalId.source == "rawg")).first()
        if not ext:
            return False
        try:
            others = (await rawg.api.get(f"/games/{ext.ext_id}/game-series", {"page_size": 20, **rawg._key()}) or {}).get("results", [])
        except ProviderUnavailable:
            return False  # offline: try again next time the page opens
        hits = [rawg._hit(x) for x in others]
        parts = sorted([SearchHit("game", "rawg", ext.ext_id, item.title, item.year), *hits], key=lambda h: h.year or 9999)
        name = series_name(item.title, [h.title for h in parts]) or item.title
        item.details = {**item.details, "collection": {"name": name, "parts": [h.__dict__ for h in parts]} if hits else None}
        s.add(item)
        s.commit()
    parts = (item.details["collection"] or {}).get("parts", [])
    if any(not items.find(s, h["source"], h["ext_id"]) for h in parts):
        jobs.enqueue(f"collection:{item.id}", lambda i=item.id: _cache_collection(i))
    return jobs.status.get(f"collection:{item.id}", {}).get("state") in ("queued", "running")


async def _cache_collection(item_id: int) -> None:
    from .providers.base import SearchHit
    from .recommender.media import (
        _light,  # late import: the recommender imports this module
    )

    with Session(db.engine) as s:
        item = s.get(Item, item_id)
        for h in ((item.details.get("collection") if item else None) or {}).get("parts", []):
            await _light(s, "game", SearchHit(**h))
    request_box_art()
