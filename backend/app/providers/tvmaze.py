"""TVmaze: exact episode airstamps (UTC), show status and the update feed. Free, no key.
Data CC BY-SA, attributed on the About page. Limit: at least 20 calls / 10 s per IP; we stay under 2/s."""
from datetime import UTC, datetime

from .base import EpisodeData, parse_date
from .http import DAY, Client

STATUS = {"Running": "returning", "Ended": "ended", "To Be Determined": "returning", "In Development": "upcoming"}

api = Client("TVmaze", "https://api.tvmaze.com", rate=1.8, ttl=DAY // 4)


def _stamp(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError:
        return None


async def lookup_imdb(imdb_id: str) -> dict | None:
    """{tvmaze_id, status, network} for a show, or None if TVmaze doesn't know it."""
    d = await api.get("/lookup/shows", {"imdb": imdb_id}, ttl=7 * DAY)
    if not d:
        return None
    return {"tvmaze_id": str(d["id"]), "status": STATUS.get(d.get("status", ""), "returning"),
            "network": (d.get("network") or d.get("webChannel") or {}).get("name")}


async def episodes(tvmaze_id: str) -> list[EpisodeData]:
    rows = await api.get(f"/shows/{tvmaze_id}/episodes", {"specials": 1}) or []
    out = []
    specials = 0
    for e in rows:
        regular = e.get("type", "regular") == "regular" and e.get("number") is not None
        specials += not regular
        season = e["season"] if regular else 0
        stamp = _stamp(e.get("airstamp"))
        if stamp is None and (d := parse_date(e.get("airdate"))):
            stamp = datetime(d.year, d.month, d.day, tzinfo=UTC)
        out.append(EpisodeData(season=season, number=e["number"] if regular else specials, title=e.get("name"), airstamp_utc=stamp,
                               runtime_min=e.get("runtime"), provider_ids={"tvmaze": str(e["id"])}))
    return out


async def updates(window: str = "day") -> dict[str, int]:
    """tvmaze_id -> last-updated unix time for every show changed in the window (day | week | month)."""
    d = await api.get("/updates/shows", {"since": window}, ttl=3600) or {}
    return {str(k): int(v) for k, v in d.items()}


async def changed_since(since: datetime) -> set[str]:
    age = (datetime.now(UTC) - since).total_seconds()
    window = "day" if age <= DAY else "week" if age <= 7 * DAY else "month"
    cutoff = since.timestamp()
    return {k for k, t in (await updates(window)).items() if t >= cutoff}
