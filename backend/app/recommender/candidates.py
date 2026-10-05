"""Candidate generation (ARCHITECTURE §5): TMDB recommendations/similar for top watches, plus discover queries."""
import asyncio
from collections import Counter, defaultdict
from datetime import date, timedelta

from sqlmodel import Session, select

from .. import tmdb
from ..cards import watch_stats, watchlist_ids
from ..models import Feedback, Movie

TARGET = 450


def excluded(s: Session) -> set[int]:
    seen = set(watch_stats(s))
    hidden = set(s.exec(select(Feedback.tmdb_id).where(Feedback.signal.in_(["not_interested", "dislike"]))))  # type: ignore[attr-defined]
    return seen | watchlist_ids(s) | hidden


def seeds(s: Session, stats=None, n: int = 15) -> list[tuple[Movie, float]]:
    """My highest-rated watches from the last two years, falling back to all time."""
    stats = stats or watch_stats(s)
    rated = [(i, st.my_rating, st.latest.watched_on) for i, st in stats.items() if st.my_rating is not None]
    recent = [r for r in rated if r[2] >= date.today() - timedelta(days=730)]
    pool = recent if len(recent) >= 5 else rated
    pool.sort(key=lambda r: (r[1], r[2]), reverse=True)
    return [(m, r) for i, r, _ in pool[:n] if (m := s.get(Movie, i))]


async def generate(s: Session) -> dict[int, list[str]]:
    """tmdb_id -> sources. Details are fetched for any candidate not cached yet."""
    stats = watch_stats(s)
    top = seeds(s, stats)
    sources: dict[int, list[str]] = defaultdict(list)

    async def collect(tag: str, path: str, **params) -> None:
        for r in await tmdb.lists(path, **params):
            if tag not in sources[r["id"]]:
                sources[r["id"]].append(tag)

    jobs = []
    for m, _ in top:
        jobs.append(collect(f"tmdb_recs:{m.tmdb_id}", f"/movie/{m.tmdb_id}/recommendations"))
        jobs.append(collect(f"tmdb_similar:{m.tmdb_id}", f"/movie/{m.tmdb_id}/similar"))

    # rating-weighted taste counts for discover
    liked = [(s.get(Movie, i), st.my_rating) for i, st in stats.items() if st.my_rating]
    genre_w: Counter[int] = Counter()
    kw_w: Counter[int] = Counter()
    dir_w: Counter[int] = Counter()
    for m, r in liked:
        if not m or r is None or r < 7:
            continue
        genre_w.update({g: r for g in m.genre_ids})
        kw_w.update({k: r for k in m.keyword_ids[:15]})
        dir_w.update({d["id"]: r for d in m.directors})
    common = dict(sort_by="vote_average.desc", **{"vote_count.gte": 200})
    for g, _ in genre_w.most_common(3):
        jobs.append(collect(f"discover:genre:{g}", "/discover/movie", with_genres=g, **common))
    for k, _ in kw_w.most_common(10):
        jobs.append(collect(f"discover:keyword:{k}", "/discover/movie", with_keywords=k, **{"vote_count.gte": 50, "sort_by": "vote_average.desc"}))
    for d, _ in dir_w.most_common(5):
        jobs.append(collect(f"discover:director:{d}", "/discover/movie", with_crew=d, sort_by="popularity.desc"))
    await asyncio.gather(*jobs)

    skip = excluded(s)
    ranked = sorted((i for i in sources if i not in skip), key=lambda i: len(sources[i]), reverse=True)[:TARGET]
    await tmdb.ensure_movies(s, ranked, images="light")
    return {i: sources[i] for i in ranked if s.get(Movie, i)}


def source_labels(sources: dict[int, list[str]]) -> list[str]:
    kinds = {tag.split(":")[0] for tags in sources.values() for tag in tags}
    out = []
    if kinds & {"tmdb_recs", "tmdb_similar"}:
        out.append("TMDB recs")
    if "discover" in kinds:
        out.append("discover")
    if "movielens" in kinds:
        out.append("MovieLens")
    return out
