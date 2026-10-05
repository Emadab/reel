"""Timeline and Stats."""
from collections import Counter, defaultdict
from datetime import date, timedelta
from statistics import mean

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from ..cards import film_card, hours, watch_out, watch_stats
from ..db import get_session
from ..models import Movie, Watch

router = APIRouter()
GENRE_LABELS = {"Science Fiction": "Sci-fi", "TV Movie": "TV movie"}


def today() -> date:
    return date.today()


def _movies(s: Session, watches: list[Watch]) -> dict[int, Movie]:
    ids = {w.tmdb_id for w in watches}
    return {m.tmdb_id: m for m in s.exec(select(Movie).where(Movie.tmdb_id.in_(ids)))}


@router.get("/timeline")
def timeline(year: int | None = None, s: Session = Depends(get_session)):
    year = year or today().year
    watches = list(s.exec(
        select(Watch).where(Watch.watched_on >= date(year, 1, 1), Watch.watched_on <= date(year, 12, 31))
        .order_by(Watch.watched_on, Watch.id)
    ))
    movies = _movies(s, watches)
    stats = watch_stats(s, list(movies))

    def item(w: Watch) -> dict:
        return {**film_card(movies[w.tmdb_id], stats.get(w.tmdb_id)), "watch": watch_out(w)}

    months = [{"month": m, "films": [], "approx": []} for m in range(1, 13)]
    year_only = []
    for w in watches:
        if w.tmdb_id not in movies:
            continue
        if w.date_precision == "year":
            year_only.append(item(w))
        else:
            months[w.watched_on.month - 1]["films" if w.date_precision == "day" else "approx"].append(item(w))
    return {
        "year": year,
        "totals": {
            "watches": len(watches),
            "approx": sum(w.date_precision != "day" for w in watches),
            "hours": round(hours(movies, watches), 1),
        },
        "months": months,
        "year_only": year_only,
    }


@router.get("/timeline/years")
def years(s: Session = Depends(get_session)):
    total: Counter[int] = Counter()
    approx: Counter[int] = Counter()
    for w in s.exec(select(Watch)):
        total[w.watched_on.year] += 1
        approx[w.watched_on.year] += w.date_precision != "day"
    if not total:
        return []
    return [{"year": y, "total": total[y], "approx": approx[y]} for y in range(min(total), max(max(total), today().year) + 1)]


def heatmap(s: Session) -> dict:
    """Day-precision watches over the 53 Monday-first weeks ending today."""
    end = today()
    start = end - timedelta(days=364)
    start -= timedelta(days=start.weekday())
    counts = Counter(
        w.watched_on for w in s.exec(
            select(Watch).where(Watch.date_precision == "day", Watch.watched_on >= start, Watch.watched_on <= end)
        )
    )
    return {"start": start.isoformat(), "end": end.isoformat(),
            "days": [{"date": d.isoformat(), "count": n} for d, n in sorted(counts.items())]}


@router.get("/stats")
def stats(range_: str = Query("all", alias="range"), s: Session = Depends(get_session)):
    q = select(Watch).order_by(Watch.watched_on.desc(), Watch.id.desc())
    if range_ != "all":
        if not range_.isdigit():
            raise HTTPException(422, "range must be 'all' or a year")
        y = int(range_)
        q = q.where(Watch.watched_on >= date(y, 1, 1), Watch.watched_on <= date(y, 12, 31))
    watches = list(s.exec(q))
    movies = _movies(s, watches)
    by_film: dict[int, list[Watch]] = defaultdict(list)
    for w in watches:
        by_film[w.tmdb_id].append(w)  # newest first

    ratings = [r for ws in by_film.values() if (r := next((w.rating for w in ws if w.rating is not None), None)) is not None]
    genre_n = Counter(GENRE_LABELS.get(g, g) for w in watches if w.tmdb_id in movies for g in movies[w.tmdb_id].genres)
    top = genre_n.most_common(6)
    gmax = top[0][1] if top else 1
    directors: Counter[str] = Counter()
    actors: Counter[str] = Counter()
    for i in by_film:
        if m := movies.get(i):
            directors.update({d["name"] for d in m.directors} or ({m.director} if m.director else set()))
            actors.update({c["name"] for c in m.cast if c.get("order", 99) < 5})
    avg = round(mean(ratings), 1) if ratings else None
    return {
        "kpis": {
            "films": len(by_film),
            "watches": len(watches),
            "rewatched": sum(1 for ws in by_film.values() if any(w.is_rewatch for w in ws)),
            "hours": round(hours(movies, watches), 1),
            "viewing_days": len({w.watched_on for w in watches if w.date_precision == "day"}),
            "first_year": min((w.watched_on.year for w in watches), default=None),
            "avg_rating": avg,
        },
        "genres": [{"name": g, "value": round(n / gmax, 3), "count": n} for g, n in top],
        "directors": [{"name": n, "count": c} for n, c in directors.most_common(5)],
        "actors": [{"name": n, "count": c} for n, c in actors.most_common(5)],
        "ratings": [{"bin": b, "count": sum(1 for r in ratings if max(1, min(10, int(r))) == b)} for b in range(1, 11)],  # 8.5 → bin 8
        "mean": avg,
        "heatmap": heatmap(s),
    }
