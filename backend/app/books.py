"""Books: Open Library work + Hardcover series/release date + Google Books fallback, and reading progress.
Reaching 100% derives `finished` unless the run is in a sticky state (paused, did_not_finish)."""
from sqlmodel import Session

from .models_media import Event, Item, Run
from .providers import googlebooks, hardcover, openlibrary
from .providers.base import ItemData
from .providers.http import ProviderUnavailable
from .status import transition


async def fetch_book(work_id: str) -> ItemData | None:
    d = await openlibrary.fetch(work_id)
    if d is None:
        return None
    isbn = d.external_ids.get("isbn13")
    try:
        if isbn and (hc := await hardcover.by_isbn(isbn)):
            d.external_ids["hardcover"] = hc["hardcover_id"]
            d.details["series"] = hc["series"]
            if hc["release_date"]:
                d.release_date = hc["release_date"]
        if not d.overview or not d.details.get("pages"):
            authors = d.details.get("authors") or [None]
            if g := await googlebooks.lookup(isbn, d.title, authors[0]):
                d.overview = d.overview or g["description"]
                d.details["pages"] = d.details.get("pages") or g["pages"]
                d.release_date = d.release_date or g["published"]
    except ProviderUnavailable:
        pass  # fallbacks are optional
    if d.release_date and not d.year:
        d.year = d.release_date.year
    return d


def update_progress(s: Session, item: Item, run: Run, unit: str | None, current: float | None, total: float | None) -> None:
    p = dict(run.progress)
    p["unit"] = unit or p.get("unit") or "page"
    if current is not None:
        p["current"] = current
    p["total"] = total or p.get("total") or (100 if p["unit"] == "percent" else item.details.get("pages"))
    run.progress = p
    s.add(run)
    s.add(Event(item_id=item.id, run_id=run.id, kind="progress", payload=p))  # type: ignore[arg-type]
    if run.status is None and p.get("current"):
        transition(s, run, "book", "reading", source="derived")
    if p.get("total") and p.get("current", 0) >= p["total"]:
        transition(s, run, "book", "finished", source="derived")


def fraction(run: Run | None) -> float | None:
    p = run.progress if run else {}
    return min(p["current"] / p["total"], 1.0) if p.get("total") and p.get("current") is not None else None
