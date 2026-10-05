"""Google Books: fallback descriptions, page counts and categories (about 1,000 requests a day with a key)."""
from ..config import settings
from .base import parse_date
from .http import DAY, Client

api = Client("Google Books", "https://www.googleapis.com/books/v1", rate=1.0, ttl=30 * DAY)


async def lookup(isbn: str | None, title: str, author: str | None) -> dict | None:
    """{description, pages, categories, published} for the best match, or None."""
    q = f"isbn:{isbn}" if isbn else f'intitle:"{title}"' + (f' inauthor:"{author}"' if author else "")
    d = await api.get("/volumes", {"q": q, "maxResults": 1, "key": settings.google_books_key or None}) or {}
    items = d.get("items") or []
    if not items:
        return None
    v = items[0].get("volumeInfo", {})
    return {"description": v.get("description"), "pages": v.get("pageCount"), "categories": v.get("categories", []),
            "published": parse_date(v.get("publishedDate"))}
