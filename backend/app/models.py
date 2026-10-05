from datetime import UTC, date, datetime
from typing import Literal

from sqlmodel import JSON, Column, Field, SQLModel, String


class Movie(SQLModel, table=True):
    tmdb_id: int = Field(primary_key=True)
    imdb_id: str | None = None
    title: str
    year: int | None = None
    release_date: date | None = None
    runtime: int | None = None
    overview: str = ""
    tagline: str = ""
    genres: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    director: str | None = None
    cast: list[dict] = Field(default_factory=list, sa_column=Column(JSON))  # name, character, profile_path
    keywords: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    language: str | None = None
    poster_path: str | None = None  # local file in data/posters, served at /images/
    backdrop_path: str | None = None
    trailer_key: str | None = None  # YouTube video id
    palette: list[str] = Field(default_factory=list, sa_column=Column(JSON))  # hex colours, dominant first
    tmdb_rating: float | None = None
    fetched_at: datetime


class WatchFields(SQLModel):
    watched_on: date
    date_precision: Literal["day", "month", "year"] = Field(default="day", sa_type=String)
    rating: float | None = Field(default=None, ge=0.5, le=5, multiple_of=0.5)
    location: str | None = None
    with_whom: str | None = None
    notes: str | None = None


class WatchIn(WatchFields):
    tmdb_id: int


class WatchUpdate(SQLModel):
    watched_on: date | None = None
    date_precision: Literal["day", "month", "year"] | None = None
    rating: float | None = Field(default=None, ge=0.5, le=5, multiple_of=0.5)
    location: str | None = None
    with_whom: str | None = None
    notes: str | None = None


class Watch(WatchFields, table=True):
    id: int | None = Field(default=None, primary_key=True)
    tmdb_id: int = Field(foreign_key="movie.tmdb_id", index=True)
    is_rewatch: bool = False


class Watchlist(SQLModel, table=True):
    tmdb_id: int = Field(foreign_key="movie.tmdb_id", primary_key=True)
    added_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    priority: int = 0


class Feedback(SQLModel, table=True):  # written to by the recommender UI in phase 5
    id: int | None = Field(default=None, primary_key=True)
    tmdb_id: int = Field(index=True)
    signal: str  # like | dislike | not_interested | opened
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
