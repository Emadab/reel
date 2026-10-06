"""Hardcover (beta GraphQL API, personal token, 60 requests a minute): book series and release dates,
plus description, pages, genres, moods and cover to fill what Open Library and Google Books leave out."""
import re

from ..config import settings
from .base import SearchHit, parse_date, year_of
from .http import DAY, Client

api = Client("Hardcover", "https://api.hardcover.app/v1", rate=0.9, ttl=7 * DAY)

BOOK = "id title release_date book_series { position series { id name } }"
FULL = BOOK + " description pages cached_tags image { url }"


def _tags(cached: dict | None, *cats: str) -> list[str]:
    return [t["tag"] for c in cats for t in (cached or {}).get(c) or [] if t.get("tag")]


def enabled() -> bool:
    return bool(settings.hardcover_token)


async def _q(query: str, variables: dict) -> dict:
    d = await api.post("/graphql", {"query": query, "variables": variables},
                       headers={"authorization": f"Bearer {settings.hardcover_token}"}) or {}
    return d.get("data") or {}


async def by_isbn(isbn13: str) -> dict | None:
    """{hardcover_id, release_date, series: [{id, name, position}], description, pages, genres, tags, cover_url}."""
    if not enabled():
        return None
    d = await _q(f"query($isbn: String!) {{ editions(where: {{isbn_13: {{_eq: $isbn}}}}, limit: 1) {{ book {{ {FULL} }} }} }}", {"isbn": isbn13})
    eds = d.get("editions") or []
    if not eds or not eds[0].get("book"):
        return None
    b = eds[0]["book"]
    return {"hardcover_id": str(b["id"]), "release_date": parse_date(b.get("release_date")),
            "series": [{"id": str(s["series"]["id"]), "name": s["series"]["name"], "position": s.get("position")}
                       for s in b.get("book_series", []) if s.get("series")],
            "description": re.sub(r"<[^>]+>", "", b.get("description") or "").strip() or None,
            "pages": b.get("pages"), "genres": _tags(b.get("cached_tags"), "Genre"),
            "tags": _tags(b.get("cached_tags"), "Mood", "Tag"), "cover_url": (b.get("image") or {}).get("url")}


async def series_books(series_id: str) -> list[SearchHit]:
    """Every book in a series with its release date (announcements for followed series)."""
    if not enabled():
        return []
    d = await _q(f"query($id: Int!) {{ series(where: {{id: {{_eq: $id}}}}) {{ book_series {{ book {{ {BOOK} }} }} }} }}", {"id": int(series_id)})
    out = []
    for s in d.get("series") or []:
        for bs in s.get("book_series", []):
            b = bs["book"]
            out.append(SearchHit("book", "hardcover", str(b["id"]), b.get("title") or "?", year_of(b.get("release_date")), b.get("release_date")))
    return out
