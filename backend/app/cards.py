"""Shared response builders (FilmCard, WatchOut) and watch aggregates."""
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

from sqlmodel import Session, select

from . import media
from .models import Movie, Watch, WatchlistItem


UNKNOWN_DATE = date.min  # an unknown watch date sorts before every real one and never reaches a timeline


def normalize(d: date, precision: str) -> date:
    """Month precision stores the 1st, year precision stores Jan 1, unknown stores 0001-01-01."""
    if precision == "unknown":
        return UNKNOWN_DATE
    if precision == "year":
        return d.replace(month=1, day=1)
    if precision == "month":
        return d.replace(day=1)
    return d


def fix_rewatches(s: Session, tmdb_id: int) -> None:
    """Every watch after the earliest is a rewatch. The earliest keeps the user's own flag,
    since a film may have been seen before tracking started."""
    ws = s.exec(select(Watch).where(Watch.tmdb_id == tmdb_id).order_by(Watch.watched_on, Watch.id)).all()
    for w in ws[1:]:
        if not w.is_rewatch:
            w.is_rewatch = True
            s.add(w)
    s.commit()


def watch_out(w: Watch) -> dict:
    return {
        "id": w.id, "tmdb_id": w.tmdb_id, "watched_on": w.watched_on.isoformat(), "date_precision": w.date_precision,
        "rating": w.rating, "is_rewatch": w.is_rewatch, "location": w.location, "with_whom": w.with_whom, "notes": w.notes,
    }


@dataclass
class FilmStats:
    watches: list[Watch] = field(default_factory=list)  # newest first

    @property
    def count(self) -> int:
        return len(self.watches)

    @property
    def latest(self) -> Watch | None:
        return self.watches[0] if self.watches else None

    @property
    def my_rating(self) -> float | None:
        """The most recent watch that has a rating."""
        return next((w.rating for w in self.watches if w.rating is not None), None)


def watch_stats(s: Session, ids: list[int] | None = None) -> dict[int, FilmStats]:
    q = select(Watch).order_by(Watch.watched_on.desc(), Watch.id.desc())
    if ids is not None:
        q = q.where(Watch.tmdb_id.in_(ids))
    out: dict[int, FilmStats] = defaultdict(FilmStats)
    for w in s.exec(q):
        out[w.tmdb_id].watches.append(w)
    return out


def watchlist_ids(s: Session) -> set[int]:
    return set(s.exec(select(WatchlistItem.tmdb_id)))


def film_card(m: Movie, st: FilmStats | None = None, on_watchlist: bool = False) -> dict:
    st = st or FilmStats()
    last = st.latest
    return {
        "tmdb_id": m.tmdb_id,
        "title": m.title,
        "year": m.year,
        "director": m.director,
        "runtime": m.runtime,
        "poster": media.media_url("poster", m.tmdb_id),
        "poster_sm": media.media_url("poster_sm", m.tmdb_id),
        "palette": m.palette,
        "poster_art": media.poster_art(m.tmdb_id, m.palette, m.dominant),
        "genres": m.genres,
        "my_rating": st.my_rating,
        "watch_count": st.count,
        "on_watchlist": on_watchlist,
        "last_watched": {"date": last.watched_on.isoformat(), "precision": last.date_precision} if last else None,
    }


def cards(s: Session, movies: list[Movie]) -> list[dict]:
    stats = watch_stats(s, [m.tmdb_id for m in movies])
    wl = watchlist_ids(s)
    return [film_card(m, stats.get(m.tmdb_id), m.tmdb_id in wl) for m in movies]


def hours(movies: dict[int, Movie], watches: list[Watch]) -> float:
    return sum((movies[w.tmdb_id].runtime or 0) for w in watches if w.tmdb_id in movies) / 60
