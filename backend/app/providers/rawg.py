"""RAWG: games (metadata, covers, platforms, average playtime, DLC, series). Needs RAWG_KEY.
20,000 requests a month, so details are cached for 30 days. Attribution: a link to rawg.io (About page).
Stands in for IGDB, which needs Twitch two-factor auth; RAWG's playtime is a single average, not per goal."""
import re
from datetime import date

from fastapi import HTTPException

from .. import media
from ..config import settings
from . import boxart
from .base import ItemData, PersonData, SearchHit, parse_date, year_of
from .http import DAY, Client

api = Client("RAWG", "https://api.rawg.io/api", rate=4.0, ttl=30 * DAY)
# not "sandbox": GTA V, Red Dead and most open-world games carry it and still have an ending
ENDLESS_TAGS = {"mmo", "mmorpg", "massively-multiplayer", "live-service", "endless", "open-ended"}

name = "rawg"
kinds = {"game"}


def _key() -> dict:
    if not settings.rawg_key:
        raise HTTPException(503, "RAWG key missing. Add it in Settings to search games.")
    return {"key": settings.rawg_key}


def _platforms(d: dict) -> list[str]:
    return [p["platform"]["name"] for p in d.get("platforms") or [] if p.get("platform")]


def _hit(d: dict) -> SearchHit:
    return SearchHit("game", "rawg", str(d["id"]), d.get("name") or "?", year_of(d.get("released")),
                     ", ".join(_platforms(d)[:3]) or None, d.get("background_image"))


async def search(q: str, kind="game") -> list[SearchHit]:
    d = await api.get("/games", {"search": q, "page_size": 20, **_key()}, ttl=DAY) or {}
    return [_hit(x) for x in d.get("results", [])]


async def steam_id(ext_id: str, d: dict) -> str | None:
    """The Steam app id, from RAWG's store links (only fetched when the game is on Steam)."""
    if not any((s.get("store") or {}).get("slug") == "steam" for s in d.get("stores") or []):
        return None
    links = (await api.get(f"/games/{ext_id}/stores", _key()) or {}).get("results", [])
    return next((m.group(1) for s in links if (m := re.search(r"store\.steampowered\.com/app/(\d+)", s.get("url") or ""))), None)


async def box_art(title: str, year: int | None, ext_id: str, d: dict) -> str | None:
    """The first box art that downloads: Wikipedia's, then Steam's (see boxart.py)."""
    for url in await boxart.covers(title, year, await steam_id(ext_id, d)):
        if await media.store_image("game", url):
            return url
    return None


async def fetch(ext_id: str, kind="game") -> ItemData | None:
    d = await api.get(f"/games/{ext_id}", _key())
    if not d:
        return None
    adds = (await api.get(f"/games/{ext_id}/additions", {"page_size": 40, **_key()}) or {}).get("results", [])
    series = (await api.get(f"/games/{ext_id}/game-series", {"page_size": 20, **_key()}) or {}).get("results", [])
    shots = (await api.get(f"/games/{ext_id}/screenshots", {"page_size": 8, **_key()}) or {}).get("results", [])
    released = parse_date(d.get("released"))
    tags = [t["slug"] for t in d.get("tags", []) if t.get("language", "eng") == "eng"]
    genres = [g["name"] for g in d.get("genres", [])]
    people = [PersonData(x["name"], "developer", ext_id=str(x["id"])) for x in d.get("developers", [])]
    people += [PersonData(x["name"], "publisher", ext_id=str(x["id"])) for x in d.get("publishers", [])]
    cover = await box_art(d.get("name") or "", year_of(d.get("released")), ext_id, d) or d.get("background_image")
    return ItemData(
        kind="game", title=d.get("name") or "?", original_title=d.get("name_original"), external_ids={"rawg": str(d["id"]), "rawg_slug": d.get("slug", "")},
        year=year_of(d.get("released")), release_date=released, overview=d.get("description_raw") or None,
        genres=genres, tags=[t["name"] for t in d.get("tags", [])[:20]],
        cover_url=cover, backdrop_url=d.get("background_image_additional") or d.get("background_image"),
        status="upcoming" if d.get("tba") or not released or released > date.today() else "released",
        endless=bool(ENDLESS_TAGS & set(tags)) or "Massively Multiplayer" in genres,
        people=people,
        details={"platforms": _platforms(d), "playtime_hours": d.get("playtime") or None, "metacritic": d.get("metacritic"),
                 "rating": d.get("rating"), "rating_votes": d.get("ratings_count"), "box_art_tried": True, "esrb": (d.get("esrb_rating") or {}).get("name"), "website": d.get("website") or None,
                 "stores": [s["store"]["name"] for s in d.get("stores", []) if s.get("store")],
                 "screenshots": [s["image"] for s in shots if s.get("image")],
                 "dlc": [{"rawg": str(a["id"]), "name": a.get("name"), "released": a.get("released")} for a in adds]},
        recommendations=[_hit(x) for x in series],
    )


async def discover(genres: list[str] | None = None, tags: list[str] | None = None, page_size: int = 40) -> list[SearchHit]:
    """Well-rated games for genre/tag slugs (recommendation candidates)."""
    p = {"genres": ",".join(genres or []) or None, "tags": ",".join(tags or []) or None, "ordering": "-rating",
         "metacritic": "70,100", "page_size": page_size, **_key()}
    return [_hit(x) for x in (await api.get("/games", p, ttl=7 * DAY) or {}).get("results", [])]


async def changed_since(since) -> set[str]:
    return set()  # no change feed; refreshes are age-based
