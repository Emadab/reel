from collections import Counter
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select

from .. import tmdb
from ..cards import film_card, hours, watch_out, watch_stats
from ..db import get_session
from ..models import Movie, WatchlistItem

router = APIRouter()
Sort = Literal["recent", "rating", "year", "title", "runtime"]


def _decade(m: Movie) -> int | None:
    return m.year // 10 * 10 if m.year else None


def _directors(m: Movie) -> list[str]:
    return [d["name"] for d in m.directors] or ([m.director] if m.director else [])


@router.get("/library")
def library(
    tab: Literal["watched", "watchlist", "rewatches"] = "watched",
    genre: list[str] = Query(default=[]),
    decade: list[int] = Query(default=[]),
    min_rating: float | None = None,
    director: str | None = None,
    sort: Sort = "recent",
    cursor: int = 0,
    limit: int = Query(default=60, le=200),
    s: Session = Depends(get_session),
):
    stats = watch_stats(s)
    wl = {w.tmdb_id: w for w in s.exec(select(WatchlistItem))}
    movies = {m.tmdb_id: m for m in s.exec(select(Movie).where(Movie.tmdb_id.in_(set(stats) | set(wl))))}
    all_watches = [w for st in stats.values() for w in st.watches]

    if tab == "watchlist":
        ids = list(wl)
    elif tab == "rewatches":
        ids = [i for i, st in stats.items() if st.count >= 2]
    else:
        ids = list(stats)
    ids = [i for i in ids if i in movies]

    def keep(i: int) -> bool:
        m, st = movies[i], stats.get(i)
        if genre and not set(genre) & set(m.genres):
            return False
        if decade and _decade(m) not in decade:
            return False
        if min_rating is not None and (not st or (st.my_rating or 0) < min_rating):
            return False
        if director and director not in _directors(m):
            return False
        return True

    ids = [i for i in ids if keep(i)]
    if sort == "recent":
        if tab == "watchlist":
            ids.sort(key=lambda i: tmdb.utc(wl[i].added_at), reverse=True)
        else:
            ids.sort(key=lambda i: (stats[i].latest.watched_on, stats[i].latest.created_at), reverse=True)
    elif sort == "rating":
        ids.sort(key=lambda i: (stats[i].my_rating if i in stats and stats[i].my_rating else -1), reverse=True)
    elif sort == "year":
        ids.sort(key=lambda i: movies[i].year or 0, reverse=True)
    elif sort == "title":
        ids.sort(key=lambda i: movies[i].title.lower())
    else:
        ids.sort(key=lambda i: movies[i].runtime or 0, reverse=True)

    items = []
    for i in ids[cursor:cursor + limit]:
        c = film_card(movies[i], stats.get(i), i in wl)
        if i in wl:
            c["added_at"] = tmdb.utc(wl[i].added_at).isoformat()
        items.append(c)

    last = max(all_watches, key=lambda w: (w.watched_on, tmdb.utc(w.created_at)), default=None)
    return {
        "counts": {
            "watched": len(stats),
            "watchlist": len(wl),
            "rewatches": sum(1 for st in stats.values() if st.count >= 2),
        },
        "totals": {"films": len(stats), "watches": len(all_watches), "hours": round(hours(movies, all_watches))},
        "last_watched": {
            **film_card(movies[last.tmdb_id], stats[last.tmdb_id], last.tmdb_id in wl),
            "watch": watch_out(last),
        } if last else None,
        "items": items,
        "next_cursor": cursor + limit if cursor + limit < len(ids) else None,
    }


@router.get("/library/facets")
def facets(s: Session = Depends(get_session)):
    stats = watch_stats(s)
    ids = set(stats) | set(s.exec(select(WatchlistItem.tmdb_id)))
    movies = list(s.exec(select(Movie).where(Movie.tmdb_id.in_(ids))))
    genres = Counter(g for m in movies for g in m.genres)
    directors = Counter(d for m in movies for d in _directors(m))
    return {
        "genres": [g for g, _ in genres.most_common()],
        "decades": sorted({d for m in movies if (d := _decade(m))}, reverse=True),
        "directors": [d for d, _ in directors.most_common()],
    }
