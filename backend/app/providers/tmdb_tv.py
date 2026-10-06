"""TMDB TV: canonical show metadata, images, seasons, episodes, external ids and recommendations.
Reuses the movie client's auth and retry (app/tmdb.py) without changing it."""
import asyncio
from datetime import UTC, datetime, time

from .. import tmdb
from ..media import CDN
from .base import EpisodeData, ItemData, PersonData, SearchHit, SeasonData, parse_date, year_of

STATUS = {"Returning Series": "returning", "Ended": "ended", "Canceled": "canceled",
          "In Production": "upcoming", "Planned": "upcoming", "Pilot": "upcoming"}


def img(path: str | None, size: str = "w500") -> str | None:
    return f"{CDN}/{size}{path}" if path else None


def _hit(r: dict) -> SearchHit:
    return SearchHit("show", "tmdb_tv", str(r["id"]), r.get("name") or r.get("original_name") or "?",
                     year_of(r.get("first_air_date")), None, img(r.get("poster_path"), "w185"))


class TmdbTV:
    name = "tmdb_tv"
    kinds = {"show"}

    async def search(self, q: str, kind="show") -> list[SearchHit]:
        data = await tmdb.get("/search/tv", query=q, include_adult="false", page=1)
        return [_hit(r) for r in data.get("results", [])[:20]]

    async def fetch(self, ext_id: str, kind="show") -> ItemData | None:
        d = await tmdb.get(f"/tv/{ext_id}", append_to_response="external_ids,aggregate_credits,keywords,recommendations,content_ratings")
        seasons = [s for s in d.get("seasons", []) if s.get("season_number") is not None]
        raw = await asyncio.gather(*(tmdb.get(f"/tv/{ext_id}/season/{s['season_number']}") for s in seasons), return_exceptions=True)
        episodes = []
        for season in raw:
            if isinstance(season, BaseException):
                continue
            for e in season.get("episodes", []):
                aired = parse_date(e.get("air_date"))
                episodes.append(EpisodeData(
                    season=e["season_number"], number=e["episode_number"], title=e.get("name"), overview=e.get("overview") or None,
                    # TMDB only has a date; TVmaze replaces this with the exact airstamp when it knows the show
                    airstamp_utc=datetime.combine(aired, time(), UTC) if aired else None,
                    runtime_min=e.get("runtime"), still_url=img(e.get("still_path"), "w300"),
                    provider_ids={"tmdb": str(e["id"])}))
        ext = d.get("external_ids") or {}
        ids = {"tmdb_tv": str(d["id"])} | {k: str(ext[v]) for k, v in (("imdb", "imdb_id"), ("tvdb", "tvdb_id")) if ext.get(v)}
        people = [PersonData(c["name"], "creator", ext_id=str(c["id"]), photo_url=img(c.get("profile_path"), "w185")) for c in d.get("created_by", [])]
        for c in (d.get("aggregate_credits") or {}).get("cast", [])[:12]:
            roles = c.get("roles") or [{}]
            people.append(PersonData(c["name"], "cast", roles[0].get("character"), str(c["id"]), img(c.get("profile_path"), "w185")))
        cert = next((r.get("rating") for r in (d.get("content_ratings") or {}).get("results", []) if r.get("iso_3166_1") == "US"), None)
        return ItemData(
            kind="show", title=d.get("name") or "?", original_title=d.get("original_name"), external_ids=ids,
            year=year_of(d.get("first_air_date")), release_date=parse_date(d.get("first_air_date")),
            overview=d.get("overview") or None, tagline=d.get("tagline") or None,
            genres=[g["name"] for g in d.get("genres", [])],
            tags=[k["name"] for k in (d.get("keywords") or {}).get("results", [])][:20],
            cover_url=img(d.get("poster_path")), backdrop_url=img(d.get("backdrop_path"), "w1280"),
            status=STATUS.get(d.get("status", ""), "returning"),  # type: ignore[arg-type]
            people=people,
            details={"networks": [n["name"] for n in d.get("networks", [])], "certification": cert,
                     "episode_runtime": (d.get("episode_run_time") or [None])[0], "language": d.get("original_language"),
                     "countries": d.get("origin_country", []), "tmdb_rating": d.get("vote_average"),
                     "tmdb_votes": d.get("vote_count"), "last_air_date": d.get("last_air_date"),
                     "next_episode": (d.get("next_episode_to_air") or {}).get("air_date")},
            seasons=[SeasonData(s["season_number"], s.get("name"), parse_date(s.get("air_date")), s.get("episode_count") or 0,
                                img(s.get("poster_path"), "w342")) for s in seasons],
            episodes=episodes,
            recommendations=[_hit(r) for r in (d.get("recommendations") or {}).get("results", [])[:20]],
        )

    async def changed_since(self, since: datetime) -> set[str]:
        return set()  # TVmaze's update feed drives show refreshes


provider = TmdbTV()
