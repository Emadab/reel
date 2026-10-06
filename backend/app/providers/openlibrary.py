"""Open Library: canonical books (work key), authors, covers. No key; identify with a contact email
in the User-Agent (CONTACT_EMAIL), which raises the limit from 1 to 3 requests per second."""
from statistics import median

from ..config import settings
from .base import ItemData, PersonData, SearchHit, parse_date, year_of
from .http import DAY, Client

COVERS = "https://covers.openlibrary.org/b/id"
api = Client("Open Library", "https://openlibrary.org", rate=2.5 if settings.contact_email else 0.9, ttl=7 * DAY)
FIELDS = "key,title,author_name,author_key,first_publish_year,cover_i,isbn,number_of_pages_median,subject"

name = "openlibrary"
kinds = {"book"}


def cover(cover_id: int | None, size: str = "L") -> str | None:
    return f"{COVERS}/{cover_id}-{size}.jpg" if cover_id and cover_id > 0 else None


def _work_id(key: str) -> str:
    return key.rsplit("/", 1)[-1]


def _text(v) -> str | None:
    s = (v.get("value") if isinstance(v, dict) else v) or None
    return s.replace("*", "").strip() if s else None  # descriptions carry markdown emphasis


def _subjects(raw: list[str]) -> list[str]:
    """'genre:fantasy' -> 'Fantasy'; other 'key:value' tags (form, nyt lists) and noise are dropped."""
    out: list[str] = []
    for s in raw:
        key, _, val = s.partition(":")
        name = val if key.lower() == "genre" and val else s if not val else ""
        name = name.strip().replace("_", " ")
        if name and len(name) <= 40 and name.lower() not in {x.lower() for x in out} and not name.lower().startswith(("accessible", "protected", "in library", "nyt:")):
            out.append(name[0].upper() + name[1:])
    return out


def _hit(d: dict) -> SearchHit:
    return SearchHit("book", "openlibrary", _work_id(d["key"]), d.get("title") or "?", d.get("first_publish_year"),
                     ", ".join(d.get("author_name", [])[:2]) or None, cover(d.get("cover_i"), "M"))


async def search(q: str, kind="book") -> list[SearchHit]:
    d = await api.get("/search.json", {"q": q, "fields": FIELDS, "limit": 20}, ttl=DAY) or {}
    return [_hit(x) for x in d.get("docs", [])]


async def by_isbn(isbn: str) -> str | None:
    """Work id for an ISBN (imports)."""
    d = await api.get("/search.json", {"isbn": isbn, "fields": "key", "limit": 1}, ttl=30 * DAY) or {}
    docs = d.get("docs") or []
    return _work_id(docs[0]["key"]) if docs else None


async def fetch(work_id: str, kind="book") -> ItemData | None:
    w = await api.get(f"/works/{work_id}.json", ttl=30 * DAY)
    if not w:
        return None
    authors = []
    for a in w.get("authors", [])[:4]:
        key = (a.get("author") or {}).get("key")
        if key and (ad := await api.get(f"{key}.json", ttl=30 * DAY)):
            authors.append(PersonData(ad.get("name") or "?", "author", ext_id=_work_id(key),
                                      photo_url=f"https://covers.openlibrary.org/a/olid/{_work_id(key)}-M.jpg?default=false"))
    eds = (await api.get(f"/works/{work_id}/editions.json", {"limit": 50}, ttl=30 * DAY) or {}).get("entries", [])
    pages = [e["number_of_pages"] for e in eds if isinstance(e.get("number_of_pages"), int) and e["number_of_pages"] > 0]
    isbn13 = next((i for e in eds for i in e.get("isbn_13", [])), None)
    first = w.get("first_publish_date")
    dates = [parse_date(e.get("publish_date")) for e in eds]
    covers = [c for c in w.get("covers", []) if c and c > 0]
    ids = {"openlibrary": work_id} | ({"isbn13": isbn13} if isbn13 else {})
    return ItemData(
        kind="book", title=w.get("title") or "?", external_ids=ids,
        year=year_of(first) or (min(d.year for d in dates if d) if any(dates) else None),
        overview=_text(w.get("description")), genres=_subjects(w.get("subjects", []))[:6], tags=_subjects(w.get("subjects", []))[6:24],
        cover_url=cover(covers[0]) if covers else None, people=authors,
        details={"pages": int(median(pages)) if pages else None, "isbn13": isbn13,
                 "authors": [a.name for a in authors], "author_ids": [a.ext_id for a in authors]},
    )


async def author_works(author_id: str) -> list[SearchHit]:
    """Newest works by an author (announcements for followed authors)."""
    d = await api.get(f"/authors/{author_id}/works.json", {"limit": 50}, ttl=DAY) or {}
    return [SearchHit("book", "openlibrary", _work_id(e["key"]), e.get("title") or "?", year_of(e.get("first_publish_date")))
            for e in d.get("entries", [])]


async def changed_since(since) -> set[str]:
    return set()  # no change feed; refreshes are age-based
