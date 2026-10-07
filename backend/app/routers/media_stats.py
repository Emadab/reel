"""Timeline and Stats for shows, books and games, and the cross-media summary (REEL_EXPANSION Phase 8).
Movies keep their own /timeline and /stats; the all-media view only reads the movie tables."""
from collections import Counter
from datetime import UTC, date, datetime, time, timedelta
from statistics import mean
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, col, func, select

from .. import items
from ..cards import hours as movie_hours
from ..db import get_session
from ..flags import KIND_FLAG, enabled, require_kind
from ..models import Movie, Watch
from ..models_media import Episode, Event, Item, LibraryEntry, Run
from ..status import FINISHED

router = APIRouter(prefix="/media")
Kind = Literal["show", "book", "game"]
DROPPED = {"show": "dropped", "book": "did_not_finish", "game": "abandoned"}
PEOPLE = {"show": ("Networks", "Created by"), "book": ("Authors", "Subjects"), "game": ("Developers", "Platforms")}


def today() -> date:
    return date.today()


def _runs(s: Session, kind: str) -> list[tuple[Item, Run]]:
    return list(s.exec(select(Item, Run).join(Run, col(Run.item_id) == col(Item.id)).where(Item.kind == kind)).all())


def _finished(s: Session, kind: str, year: int | None = None) -> list[tuple[Item, Run]]:
    out = [(i, r) for i, r in _runs(s, kind) if r.status in FINISHED and r.finished_on]
    return [(i, r) for i, r in out if year is None or (r.finished_on.year == year and r.date_precision != "unknown")]  # type: ignore[union-attr]


def _run_out(r: Run) -> dict:
    return {"id": r.id, "status": r.status, "finished_on": r.finished_on.isoformat() if r.finished_on else None,
            "precision": r.date_precision, "rating": r.rating, "run_no": r.run_no}


@router.get("/{kind}/timeline")
def timeline(kind: Kind, year: int | None = None, s: Session = Depends(get_session)):
    """What you finished each month (exact, month-only, or sometime in the year), plus each month's activity."""
    require_kind(s, kind)
    year = year or today().year
    months = [{"month": m, "items": [], "approx": [], "activity": 0} for m in range(1, 13)]
    year_only = []
    for item, run in sorted(_finished(s, kind, year), key=lambda x: (x[1].finished_on, x[1].id)):
        entry = {**items.card(s, item, run=run), "run": _run_out(run)}
        if run.date_precision == "year":
            year_only.append(entry)
        else:
            months[run.finished_on.month - 1]["items" if run.date_precision == "day" else "approx"].append(entry)  # type: ignore[union-attr]
    for e in _events(s, kind, date(year, 1, 1), date(year, 12, 31)):
        months[e.occurred_at.month - 1]["activity"] += 1  # type: ignore[operator]
    finished = sum(len(m["items"]) + len(m["approx"]) for m in months) + len(year_only)  # type: ignore[arg-type, misc]
    return {"year": year, "totals": {"finished": finished, "approx": sum(len(m["approx"]) for m in months) + len(year_only),  # type: ignore[arg-type, misc]
                                     **_amount(s, kind, year)}, "months": months, "year_only": year_only}


@router.get("/{kind}/timeline/years")
def years(kind: Kind, s: Session = Depends(get_session)):
    require_kind(s, kind)
    total: Counter[int] = Counter()
    approx: Counter[int] = Counter()
    for _, r in _finished(s, kind):
        if r.date_precision == "unknown":
            continue  # finished, but nobody knows when: not on any timeline
        total[r.finished_on.year] += 1  # type: ignore[union-attr]
        approx[r.finished_on.year] += r.date_precision != "day"  # type: ignore[union-attr]
    if not total:
        return []
    return [{"year": y, "total": total[y], "approx": approx[y]} for y in range(min(total), max(max(total), today().year) + 1)]


ACTIVITY = ("episode_watched", "progress", "session")


def _in_range(q, start: date | None, end: date | None):
    if start:
        q = q.where(col(Event.occurred_at) >= datetime.combine(start, time.min, UTC))
    if end:
        q = q.where(col(Event.occurred_at) < datetime.combine(end + timedelta(days=1), time.min, UTC))
    return q


def _events(s: Session, kind: str, start: date | None = None, end: date | None = None) -> list[Event]:
    q = select(Event).join(Item, col(Item.id) == col(Event.item_id)).where(Item.kind == kind, col(Event.kind).in_(ACTIVITY))
    return list(s.exec(_in_range(q, start, end)))


def _amount(s: Session, kind: str, year: int | None) -> dict:
    """Hours watched (shows), pages read (books) or hours played (games), within the year if given."""
    start, end = (date(year, 1, 1), date(year, 12, 31)) if year else (None, None)
    if kind == "show":
        # columns, not rows: thousands of episode ticks would otherwise each build an ORM object
        default = dict(s.exec(select(Item.id, func.json_extract(Item.details, "$.episode_runtime")).where(Item.kind == "show")).all())
        q = select(Event.item_id, Episode.runtime_min).join(Episode, col(Episode.id) == col(Event.episode_id)).where(Event.kind == "episode_watched")
        ticks = s.exec(_in_range(q, start, end)).all()
        minutes = sum(rt or default.get(i) or 30 for i, rt in ticks)
        return {"hours": round(minutes / 60, 1), "episodes": len(ticks)}
    if kind == "game":
        return {"hours": round(sum(max(e.payload.get("delta") or 0, 0) for e in _events(s, kind, start, end) if e.kind == "session"), 1)}
    # books: page progress events, as deltas per run
    pages = 0.0
    last: dict[int, float] = {}
    for e in sorted(_events(s, "book"), key=lambda e: e.occurred_at):
        if e.kind != "progress" or e.payload.get("unit", "page") != "page" or e.run_id is None:
            continue
        cur = float(e.payload.get("current") or 0)
        delta = max(cur - last.get(e.run_id, 0), 0)
        last[e.run_id] = cur
        if start is None or start <= e.occurred_at.date() <= end:  # type: ignore[operator]
            pages += delta
    return {"pages": int(pages)}


@router.get("/all/stats")
def all_stats(range_: str = Query("all", alias="range"), s: Session = Depends(get_session)):
    """Every enabled medium side by side: finishes, time spent, pages read, drop and DNF rates."""
    year = int(range_) if range_.isdigit() else None
    rows = []
    watches = list(s.exec(select(Watch)))  # read-only use of the movie tables
    watches = [w for w in watches if year is None or w.watched_on.year == year]
    ids = {w.tmdb_id for w in watches}
    movies = {m.tmdb_id: m for m in s.exec(select(Movie).where(col(Movie.tmdb_id).in_(ids)))}
    rows.append({"kind": "movie", "label": "Movies", "finished": len(ids), "finished_label": "watched",
                 "hours": round(movie_hours(movies, watches), 1), "pages": None, "drop_rate": None, "drop_label": None})
    labels = {"show": ("Shows", "completed", "dropped"), "book": ("Books", "finished", "did not finish"), "game": ("Games", "beaten or completed", "dropped")}
    for kind in ("show", "book", "game"):
        if not enabled(s, KIND_FLAG[kind]):
            continue
        st = stats(kind, range_, s)  # type: ignore[arg-type]
        k = st["kpis"]
        rows.append({"kind": kind, "label": labels[kind][0], "finished": k["finished"], "finished_label": labels[kind][1],
                     "hours": k.get("hours"), "pages": k.get("pages"), "drop_rate": k["drop_rate"], "drop_label": labels[kind][2]})
    if len(rows) == 1:
        raise HTTPException(404, "Not found")
    return {"rows": rows, "hours": round(sum(r["hours"] or 0 for r in rows), 1)}


@router.get("/{kind}/stats")
def stats(kind: Kind, range_: str = Query("all", alias="range"), s: Session = Depends(get_session)):
    require_kind(s, kind)
    year = None if range_ == "all" else int(range_) if range_.isdigit() else None
    if range_ != "all" and year is None:
        raise HTTPException(422, "range must be 'all' or a year")
    runs = _runs(s, kind)
    lib = {i.id: i for i, _ in s.exec(select(Item, LibraryEntry).join(LibraryEntry, col(LibraryEntry.item_id) == col(Item.id)).where(Item.kind == kind))}
    in_range = [(i, r) for i, r in runs if year is None or (r.finished_on or r.started_on or r.updated_at.date()).year == year]
    touched = {i.id: i for i, _ in in_range}
    finished = [(i, r) for i, r in in_range if r.status in FINISHED]
    dropped = [(i, r) for i, r in in_range if r.status == DROPPED[kind]]
    latest: dict[int, float] = {}
    for i, r in sorted(in_range, key=lambda x: x[1].run_no):
        if r.rating is not None:
            latest[i.id] = r.rating  # type: ignore[index]
    genre_n = Counter(g for i in touched.values() for g in i.genres)
    top = genre_n.most_common(6)
    gmax = top[0][1] if top else 1
    a, b = Counter(), Counter()
    for i in touched.values():
        if kind == "show":
            a.update(i.details.get("networks") or [])
        elif kind == "book":
            a.update(i.details.get("authors") or [])
            b.update(i.genres[:3])
        else:
            b.update(i.details.get("platforms") or [])
    if kind != "book":
        from ..models_media import ItemPerson, Person

        role = "creator" if kind == "show" else "developer"
        for ip, p in s.exec(select(ItemPerson, Person).join(Person, col(Person.id) == col(ItemPerson.person_id)).where(
                col(ItemPerson.item_id).in_(list(touched)), ItemPerson.role == role)):
            (b if kind == "show" else a).update([p.name])
    end = today()
    start = end - timedelta(days=364)
    start -= timedelta(days=start.weekday())
    days = Counter(e.occurred_at.date() for e in _events(s, kind, start, end) if e.date_precision == "day")
    ratings = list(latest.values())
    avg = round(mean(ratings), 1) if ratings else None
    done = len(finished) + len(dropped)
    return {
        "kpis": {"items": len(touched) if year else len(lib), "finished": len(finished), "dropped": len(dropped),
                 "drop_rate": round(len(dropped) / done, 2) if done else None,
                 "in_progress": sum(1 for _, r in in_range if r.status and r.status not in FINISHED and r.status != DROPPED[kind]),
                 "active_days": len({e.occurred_at.date() for e in _events(s, kind, *( (date(year, 1, 1), date(year, 12, 31)) if year else (None, None))) if e.date_precision == "day"}),
                 "avg_rating": avg, **_amount(s, kind, year)},
        "genres": [{"name": g, "value": round(n / gmax, 3), "count": n} for g, n in top],
        "people": [{"title": PEOPLE[kind][0], "rows": [{"name": n, "count": c} for n, c in a.most_common(5)]},
                   {"title": PEOPLE[kind][1], "rows": [{"name": n, "count": c} for n, c in b.most_common(5)]}],
        "ratings": [{"bin": k, "count": sum(1 for r in ratings if max(1, min(10, int(r))) == k)} for k in range(1, 11)],
        "mean": avg,
        "heatmap": {"start": start.isoformat(), "end": end.isoformat(),
                    "days": [{"date": d.isoformat(), "count": n} for d, n in sorted(days.items())]},
    }


# ---- recommendations and taste map ----

@router.get("/{kind}/recommendations")
def recommendations(kind: Kind, wild: bool = False, s: Session = Depends(get_session)):
    from .. import jobs
    from ..models_media import MediaCandidate, MediaFeedback
    from ..recommender import media as recs

    require_kind(s, kind)
    if recs.is_stale(s, kind):
        recs.request(kind)
    rows = s.exec(select(MediaCandidate).where(MediaCandidate.kind == kind).order_by(col(MediaCandidate.rank))).all()
    out = []
    for c in rows:
        item = s.get(Item, c.item_id)
        entry = s.get(LibraryEntry, c.item_id)
        if not item or (entry and entry.shelf == "not_interested") or (wild and not c.wildcard):
            continue
        because = [items.card(s, b) for bid in c.because if (b := s.get(Item, bid))]
        out.append({**items.card(s, item, entry), "score": round(c.score, 3), "because": because, "reasons": c.reasons,
                    "overview": item.overview, "wildcard": c.wildcard, "liked": s.get(MediaFeedback, item.id) is not None})
        if len(out) == recs.SLATE:
            break
    labelled = recs.labelled(s, kind)
    return {"items": out, "model": rows[0].model if rows else None, "learned_from": len(labelled),
            "computing": jobs.status.get(f"recs:{kind}", {}).get("state") in ("queued", "running")}


@router.post("/{kind}/recommendations/recompute", status_code=202)
def recompute(kind: Kind, s: Session = Depends(get_session)):
    from ..recommender import media as recs

    require_kind(s, kind)
    recs.request(kind)


@router.get("/{kind}/tastemap")
def tastemap(kind: Kind, s: Session = Depends(get_session)):
    from ..models_media import MediaCandidate

    require_kind(s, kind)
    slate = {c.item_id: c for c in s.exec(select(MediaCandidate).where(MediaCandidate.kind == kind))}
    lib = {e.item_id: e for e in s.exec(select(LibraryEntry))}
    points = []
    for i in s.exec(select(Item).where(Item.kind == kind, col(Item.umap_x).is_not(None))):
        if i.id in lib:
            c = items.card(s, i, lib[i.id])
            points.append({"id": i.id, "title": i.title, "x": round(i.umap_x, 4), "y": round(i.umap_y, 4), "kind": "mine",  # type: ignore[arg-type]
                           "rating": c["my_rating"], "status": c["status"], "color": i.palette[0] if i.palette else c["poster_art"]["bg"],
                           "poster": i.cover_path})
        elif i.id in slate:
            points.append({"id": i.id, "title": i.title, "x": round(i.umap_x, 4), "y": round(i.umap_y, 4), "kind": "suggested",  # type: ignore[arg-type]
                           "score": round(slate[i.id].score, 3), "poster": i.cover_path})
    return {"points": points}
