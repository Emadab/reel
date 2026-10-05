"""Normalized provider data (REEL_EXPANSION §5.4). Nothing outside providers/ sees raw provider JSON."""
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Literal, Protocol

Kind = Literal["show", "book", "game"]
ItemStatus = Literal["released", "upcoming", "returning", "ended", "canceled"]


@dataclass
class SearchHit:
    kind: Kind
    source: str
    ext_id: str
    title: str
    year: int | None = None
    subtitle: str | None = None  # network, author or platforms
    cover_url: str | None = None


@dataclass
class PersonData:
    name: str
    role: str  # creator | cast | author | developer | publisher
    character: str | None = None
    ext_id: str | None = None
    photo_url: str | None = None


@dataclass
class SeasonData:
    number: int
    name: str | None = None
    premiere_date: date | None = None
    episode_count: int = 0
    poster_url: str | None = None


@dataclass
class EpisodeData:
    season: int
    number: int
    title: str | None = None
    overview: str | None = None
    airstamp_utc: datetime | None = None
    runtime_min: int | None = None
    still_url: str | None = None
    provider_ids: dict[str, str] = field(default_factory=dict)

    @property
    def is_special(self) -> bool:
        return self.season == 0


@dataclass
class ItemData:
    kind: Kind
    title: str
    external_ids: dict[str, str]
    original_title: str | None = None
    year: int | None = None
    release_date: date | None = None
    overview: str | None = None
    tagline: str | None = None
    genres: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    cover_url: str | None = None
    backdrop_url: str | None = None
    status: ItemStatus = "released"
    endless: bool = False
    people: list[PersonData] = field(default_factory=list)
    details: dict = field(default_factory=dict)
    seasons: list[SeasonData] = field(default_factory=list)
    episodes: list[EpisodeData] = field(default_factory=list)
    recommendations: list[SearchHit] = field(default_factory=list)


class Provider(Protocol):
    name: str
    kinds: set[Kind]

    async def search(self, q: str, kind: Kind) -> list[SearchHit]: ...
    async def fetch(self, ext_id: str, kind: Kind) -> ItemData | None: ...
    async def changed_since(self, since: datetime) -> set[str]: ...  # empty set if unsupported


def year_of(d: str | None) -> int | None:
    return int(d[:4]) if d and d[:4].isdigit() else None


def parse_date(d: str | None) -> date | None:
    try:
        return date.fromisoformat(d[:10]) if d and len(d) >= 10 else None
    except ValueError:
        return None
