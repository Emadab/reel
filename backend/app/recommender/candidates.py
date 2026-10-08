"""Candidate generation (ARCHITECTURE §5): TMDB recommendations/similar for every film you've watched (kept as
links, so they're the collaborative graph too), discover queries for your favourite genres, keywords and
directors, and every film already cached. Offline, the stored links and the cache are the whole pool."""
import asyncio
from collections import Counter, defaultdict

from fastapi import HTTPException
from sqlmodel import Session, col, select

from .. import tmdb
from ..cards import watch_stats, watchlist_ids
from ..models import Feedback, Movie, MovieLink

TARGET = 450
LINK_LISTS = ("recommendations", "similar")


def excluded(s: Session) -> set[int]:
    seen = set(watch_stats(s))
    hidden = set(s.exec(select(Feedback.tmdb_id).where(Feedback.signal.in_(["not_interested", "dislike"]))))  # type: ignore[attr-defined]
    return seen | watchlist_ids(s) | hidden


async def fetch_links(s: Session, ids: list[int]) -> None:
    """TMDB's lists for films that don't have links yet; rank-discounted, both lists summed."""
    have = set(s.exec(select(MovieLink.src).where(MovieLink.dst == 0)))
    todo = [i for i in ids if i not in have]

    async def one(i: int) -> tuple[int, dict[int, float] | None]:
        w: dict[int, float] = defaultdict(float)
        try:
            for path in LINK_LISTS:
                for rank, r in enumerate((await tmdb.get(f"/movie/{i}/{path}")).get("results", [])):
                    w[r["id"]] += 1 / (rank + 1) ** 0.5
        except HTTPException:
            return i, None  # offline or not on TMDB: try again next time
        return i, w

    for i, w in await asyncio.gather(*(one(i) for i in todo)):
        if w is None:
            continue
        s.add(MovieLink(src=i, dst=0))
        for dst, x in w.items():
            if dst != i:
                s.add(MovieLink(src=i, dst=dst, weight=x))
    s.commit()


def links(s: Session) -> dict[int, dict[int, float]]:
    out: dict[int, dict[int, float]] = defaultdict(dict)
    for link in s.exec(select(MovieLink).where(MovieLink.dst != 0)):
        out[link.src][link.dst] = link.weight
    return out


async def generate(s: Session) -> dict[int, list[str]]:
    """tmdb_id -> sources. Details are fetched for any new candidate; cached films join the pool as they are."""
    stats = watch_stats(s)
    await fetch_links(s, list(stats))
    rated = {i: st.my_rating for i, st in stats.items() if st.my_rating is not None}
    sources: dict[int, list[str]] = defaultdict(list)
    graph: Counter[int] = Counter()
    for src, dsts in links(s).items():
        r = rated.get(src)
        if r is None or r < 7:
            continue
        for dst, w in dsts.items():
            sources[dst].append(f"tmdb_recs:{src}")
            graph[dst] += w * (r - 6)

    async def collect(tag: str, path: str, **params) -> None:
        for r in await tmdb.lists(path, **params):
            if tag not in sources[r["id"]]:
                sources[r["id"]].append(tag)

    # rating-weighted taste counts for discover
    genre_w: Counter[int] = Counter()
    kw_w: Counter[int] = Counter()
    dir_w: Counter[int] = Counter()
    for i, r in rated.items():
        m = s.get(Movie, i)
        if not m or r < 7:
            continue
        genre_w.update({g: r for g in m.genre_ids})
        kw_w.update({k: r for k in m.keyword_ids[:15]})
        dir_w.update({d["id"]: r for d in m.directors})
    common = dict(sort_by="vote_average.desc", **{"vote_count.gte": 200})
    jobs = []
    for g, _ in genre_w.most_common(3):
        jobs.append(collect(f"discover:genre:{g}", "/discover/movie", with_genres=g, **common))
    for k, _ in kw_w.most_common(10):
        jobs.append(collect(f"discover:keyword:{k}", "/discover/movie", with_keywords=k, **{"vote_count.gte": 50, "sort_by": "vote_average.desc"}))
    for d, _ in dir_w.most_common(5):
        jobs.append(collect(f"discover:director:{d}", "/discover/movie", with_crew=d, sort_by="popularity.desc"))
    await asyncio.gather(*jobs)

    skip = excluded(s)
    ranked = sorted((i for i in sources if i not in skip), key=lambda i: (-len(sources[i]), -graph[i]))[:TARGET]
    await tmdb.ensure_movies(s, ranked, images="light")  # offline: fails fast, cached films still count
    for i in s.exec(select(Movie.tmdb_id).where(col(Movie.embedding).is_not(None))):
        if i not in skip and i not in sources:
            sources[i] = ["cache"]
    return {i: src for i, src in sources.items() if i not in skip and (i in ranked or src == ["cache"]) and s.get(Movie, i)}


def source_labels(sources: dict[int, list[str]]) -> list[str]:
    kinds = {tag.split(":")[0] for tags in sources.values() for tag in tags}
    out = []
    if kinds & {"tmdb_recs", "tmdb_similar"}:
        out.append("TMDB recs")
    if "discover" in kinds:
        out.append("discover")
    if "cache" in kinds:
        out.append("your cache")
    return out
