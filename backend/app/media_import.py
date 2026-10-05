"""Imports for shows and books with a review screen and no duplicates (REEL_EXPANSION Phase 8).
Goodreads and StoryGraph CSV exports become books; the TV rows of an IMDb ratings export become shows.
Movies keep their own Letterboxd/IMDb import (app/importers.py, unchanged)."""
import re
from datetime import UTC, date, datetime, time

from fastapi import HTTPException
from sqlmodel import Session

from . import items, shows, tmdb
from .importers import _csv, _float
from .models_media import Event
from .providers import openlibrary
from .providers.base import Kind
from .status import transition

SOURCES: dict[str, Kind] = {"goodreads": "book", "storygraph": "book", "imdb_tv": "show"}
TV_TYPES = {"tv series", "tv mini series", "tvseries", "tvminiseries"}


def _day(v: str) -> date | None:
    v = (v or "").strip().replace("/", "-")
    try:
        return date.fromisoformat(v[:10]) if v else None
    except ValueError:
        return None


def _stars10(v: str) -> float | None:
    r = _float(v)
    return round(r * 2, 1) if r else None  # Goodreads/StoryGraph rate 1–5 stars; Reel rates 0–10


def _isbn(v: str) -> str | None:
    digits = re.sub(r"\D", "", v or "")
    return digits if len(digits) == 13 else None


def parse(source: str, data: bytes) -> list[dict]:
    rows = _csv(data)
    out = []
    if source == "goodreads":
        shelf = {"read": "finished", "currently-reading": "reading", "to-read": "wishlist"}
        for r in rows:
            st = shelf.get(r.get("Exclusive Shelf", ""))
            if not st or not r.get("Title"):
                continue
            read = _day(r.get("Date Read", ""))
            added = _day(r.get("Date Added", ""))
            out.append({"title": r["Title"], "author": r.get("Author") or None, "isbn": _isbn(r.get("ISBN13", "")),
                        "status": st, "rating": _stars10(r.get("My Rating", "")), "owned": (r.get("Owned Copies") or "0") not in ("", "0"),
                        "date": (read or added).isoformat() if (read or added) else None,
                        "precision": "day" if read else "unknown", "year": None})
    elif source == "storygraph":
        status = {"read": "finished", "currently-reading": "reading", "to-read": "wishlist", "did-not-finish": "did_not_finish", "paused": "paused"}
        for r in rows:
            st = status.get(r.get("Read Status", ""))
            if not st or not r.get("Title"):
                continue
            last = _day(r.get("Last Date Read", ""))
            added = _day(r.get("Date Added", ""))
            owned = (r.get("Owned?") or "").lower() == "yes"
            out.append({"title": r["Title"], "author": (r.get("Authors") or "").split(",")[0].strip() or None,
                        "isbn": _isbn(r.get("ISBN/UID", "")), "status": "backlog" if st == "wishlist" and owned else st,
                        "rating": _stars10(r.get("Star Rating", "")), "owned": owned,
                        "date": (last or added).isoformat() if (last or added) else None, "precision": "day" if last else "unknown", "year": None})
    else:
        for r in rows:
            if (r.get("Title Type") or "").strip().lower() not in TV_TYPES or not r.get("Const"):
                continue
            rated = _day(r.get("Date Rated", ""))
            out.append({"title": r.get("Title") or "?", "author": None, "isbn": None, "imdb": r["Const"], "status": "completed",
                        "rating": _float(r.get("Your Rating", "")), "owned": False, "year": int(r["Year"]) if (r.get("Year") or "").isdigit() else None,
                        "date": rated.isoformat() if rated else None, "precision": "day" if rated else "unknown"})
    if not out:
        raise HTTPException(422, "Nothing to import in that file")
    return out


async def match(source: str, raw: dict) -> dict:
    """{status: matched|ambiguous|unmatched, ext_id, options} for one row."""
    if source == "imdb_tv":
        d = await tmdb.get(f"/find/{raw['imdb']}", external_source="imdb_id")
        tv = d.get("tv_results") or []
        if tv:
            return {"status": "matched", "ext_id": str(tv[0]["id"]), "include": True,
                    "options": [{"ext_id": str(tv[0]["id"]), "title": tv[0].get("name"), "year": (tv[0].get("first_air_date") or "")[:4] or None}]}
        return {"status": "unmatched", "ext_id": None, "include": False, "options": []}
    if raw.get("isbn") and (work := await openlibrary.by_isbn(raw["isbn"])):
        return {"status": "matched", "ext_id": work, "include": True, "options": []}
    hits = await openlibrary.search(f"{raw['title']} {raw.get('author') or ''}".strip())
    opts = [{"ext_id": h.ext_id, "title": h.title, "year": h.year, "subtitle": h.subtitle} for h in hits[:5]]
    norm = lambda x: re.sub(r"\W+", " ", (x or "").lower()).strip()  # noqa: E731
    exact = [h for h in hits if norm(h.title) == norm(raw["title"].split(":")[0]) or norm(h.title) == norm(raw["title"])]
    if exact:
        return {"status": "matched", "ext_id": exact[0].ext_id, "include": True, "options": opts}
    return {"status": "ambiguous" if opts else "unmatched", "ext_id": None, "include": False, "options": opts}


async def commit_row(s: Session, kind: Kind, raw: dict, ext_id: str) -> bool:
    """Add one imported row. Returns False when it's already there (re-importing creates nothing new)."""
    item = await items.ensure(s, kind, ext_id)
    entry = items.library_entry(s, item)
    when = date.fromisoformat(raw["date"]) if raw.get("date") else None
    precision = raw.get("precision") or "unknown"
    st = raw["status"]
    if st in ("wishlist", "backlog"):
        if items.runs(s, item.id) or entry.shelf == st:  # type: ignore[arg-type]
            return False
        entry.shelf = st
        entry.owned = entry.owned or raw.get("owned", False)
        s.add(entry)
        s.commit()
        return True
    existing = items.runs(s, item.id)  # type: ignore[arg-type]
    if any(r.status == st or (when and r.finished_on == when) for r in existing):
        return False
    run = items.new_run(s, item, date_precision=precision, rating=raw.get("rating"), variant={"source": "import"})
    if kind == "show":
        # "I watched it": every aired episode is backfilled as watched on the rated date, then the state derives
        at = datetime.combine(when, time(12), UTC) if when else datetime.now(UTC)
        for e in shows.episodes(s, item.id):  # type: ignore[arg-type]
            if not e.is_special and shows.aired(e):
                s.add(Event(item_id=item.id, run_id=run.id, episode_id=e.id, kind="episode_watched", occurred_at=at,  # type: ignore[arg-type]
                            date_precision=precision, payload={"season": e.season, "number": e.number, "imported": True}))
        s.flush()
        shows.derive(s, item, run)
        run.finished_on = when if run.status in ("completed", "caught_up") else None
        run.started_on = None
    else:
        path = {"did_not_finish": ["reading", "did_not_finish"], "paused": ["reading", "paused"]}.get(st, [st])
        for step in path:
            transition(s, run, kind, step, when=when)
        run.started_on = None  # exports never say when you started: unknown stays unknown
        run.finished_on = when if st == "finished" else None
    if run.rating is not None:
        s.add(Event(item_id=item.id, run_id=run.id, kind="rating", payload={"rating": run.rating}))  # type: ignore[arg-type]
    s.add(run)
    s.commit()
    return True

