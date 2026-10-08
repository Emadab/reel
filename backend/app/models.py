from datetime import UTC, date, datetime
from typing import Literal

from sqlmodel import JSON, Column, Field, LargeBinary, SQLModel, String

Precision = Literal["day", "month", "year", "unknown"]
Source = Literal["manual", "letterboxd", "imdb", "onboarding", "notion"]
Signal = Literal["like", "dislike", "not_interested", "opened", "added_watchlist", "seen_rated"]


def now() -> datetime:
    return datetime.now(UTC)


def _json(default=list):
    return Field(default_factory=default, sa_column=Column(JSON))


class Movie(SQLModel, table=True):
    tmdb_id: int = Field(primary_key=True)
    imdb_id: str | None = Field(default=None, index=True)
    title: str
    original_title: str | None = None
    year: int | None = None
    release_date: date | None = None
    runtime: int | None = None
    overview: str | None = None
    tagline: str | None = None
    genres: list[str] = _json()
    director: str | None = None
    directors: list[dict] = _json()
    crew_highlights: dict = _json(dict)
    cast: list[dict] = _json()
    keywords: list[str] = _json()
    keyword_ids: list[int] = _json()
    genre_ids: list[int] = _json()
    language: str | None = None
    poster_path: str | None = None  # TMDB path; the local copy lives in data/media/poster/{tmdb_id}.jpg
    backdrop_path: str | None = None
    trailer_key: str | None = None
    palette: list[str] = _json()  # [glow, glow2, dark, light, ink]
    dominant: str | None = None  # the poster's dominant colour, used by PosterArt
    tmdb_rating: float | None = None
    tmdb_votes: int | None = None
    popularity: float | None = None
    omdb: dict | None = Field(default=None, sa_column=Column(JSON))
    extra: dict | None = Field(default=None, sa_column=Column(JSON))  # certification, money, countries, studios, collection
    fetched_at: datetime = Field(default_factory=now)
    omdb_fetched_at: datetime | None = None
    embedding: bytes | None = Field(default=None, sa_column=Column(LargeBinary))
    umap_x: float | None = None
    umap_y: float | None = None


class WatchFields(SQLModel):
    watched_on: date
    date_precision: Precision = Field(default="day", sa_type=String)
    rating: float | None = Field(default=None, gt=0, le=10)  # 0–10, one decimal
    is_rewatch: bool = False
    location: str | None = None
    with_whom: str | None = None
    notes: str | None = None


class Watch(WatchFields, table=True):
    id: int | None = Field(default=None, primary_key=True)
    tmdb_id: int = Field(foreign_key="movie.tmdb_id", index=True)
    watched_on: date = Field(index=True)
    source: Source = Field(default="manual", sa_type=String)
    created_at: datetime = Field(default_factory=now)


class WatchIn(WatchFields):
    tmdb_id: int
    source: Source = "manual"


class WatchPatch(SQLModel):
    watched_on: date | None = None
    date_precision: Precision | None = None
    rating: float | None = Field(default=None, gt=0, le=10)  # 0–10, one decimal
    is_rewatch: bool | None = None
    location: str | None = None
    with_whom: str | None = None
    notes: str | None = None


class WatchlistItem(SQLModel, table=True):
    tmdb_id: int = Field(primary_key=True, foreign_key="movie.tmdb_id")
    added_at: datetime = Field(default_factory=now)
    priority: int = 0


class Feedback(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    tmdb_id: int = Field(index=True)
    signal: Signal = Field(sa_type=String)
    created_at: datetime = Field(default_factory=now)


class Candidate(SQLModel, table=True):  # the current recommendation slate
    tmdb_id: int = Field(primary_key=True)
    sources: list[str] = _json()
    score: float
    is_wildcard: bool = False
    because: list[int] = _json()
    reasons: list[str] = _json()
    rank: int
    model_version: str
    computed_at: datetime = Field(default_factory=now)


class MovieLink(SQLModel, table=True):
    """TMDB's recommendations/similar for a film you've watched: the collaborative graph the recommender reads.
    Fetched once per film and kept, so suggestions work offline. dst 0 marks a film whose lists were fetched."""
    src: int = Field(primary_key=True)
    dst: int = Field(primary_key=True)
    weight: float = 0.0


class Setting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str


class ImportJob(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    source: str
    created_at: datetime = Field(default_factory=now)
    rows: list[dict] = _json()
    committed: bool = False
