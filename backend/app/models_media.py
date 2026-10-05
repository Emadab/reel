"""Tables for shows, books and games (docs/expansion/REEL_EXPANSION.md §5.2). Movies keep their own tables."""
from datetime import date, datetime

from sqlalchemy import UniqueConstraint
from sqlmodel import JSON, Column, Field, LargeBinary, SQLModel

from .models import now


class HttpCache(SQLModel, table=True):
    key: str = Field(primary_key=True)
    url: str
    status: int
    etag: str | None = None
    body: bytes = Field(sa_column=Column(LargeBinary))
    fetched_at: datetime = Field(default_factory=now)
    ttl_s: int


def _json(default=list):
    return Field(default_factory=default, sa_column=Column(JSON))


class Item(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    kind: str = Field(index=True)  # show | book | game
    title: str
    original_title: str | None = None
    year: int | None = None
    release_date: date | None = None
    overview: str | None = None
    tagline: str | None = None
    genres: list[str] = _json()
    tags: list[str] = _json()
    cover_path: str | None = None  # /media/<kind>/<hash>.jpg
    backdrop_path: str | None = None
    palette: list[str] = _json()
    dominant: str | None = None
    status: str = "released"  # released | upcoming | returning | ended | canceled
    endless: bool = False
    details: dict = _json(dict)
    embedding: bytes | None = Field(default=None, sa_column=Column(LargeBinary))
    umap_x: float | None = None
    umap_y: float | None = None
    refreshed_at: datetime = Field(default_factory=now)
    created_at: datetime = Field(default_factory=now)


class ExternalId(SQLModel, table=True):
    source: str = Field(primary_key=True)
    ext_id: str = Field(primary_key=True)
    item_id: int = Field(foreign_key="item.id", index=True)


class Person(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    photo_path: str | None = None
    external_ids: dict = _json(dict)


class ItemPerson(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    item_id: int = Field(foreign_key="item.id", index=True)
    person_id: int = Field(foreign_key="person.id", index=True)
    role: str
    character: str | None = None
    ord: int = 0


class Season(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    item_id: int = Field(foreign_key="item.id", index=True)
    number: int
    name: str | None = None
    premiere_date: date | None = None
    episode_count: int = 0
    poster_path: str | None = None


class Episode(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("item_id", "season", "number"),)
    id: int | None = Field(default=None, primary_key=True)
    item_id: int = Field(foreign_key="item.id", index=True)
    season: int
    number: int
    title: str | None = None
    overview: str | None = None
    airstamp_utc: datetime | None = None
    runtime_min: int | None = None
    still_path: str | None = None
    is_special: bool = False
    provider_ids: dict = _json(dict)


class LibraryEntry(SQLModel, table=True):
    item_id: int = Field(primary_key=True, foreign_key="item.id")
    shelf: str | None = None  # wishlist | backlog | not_interested
    owned: bool = False
    platforms: list[str] = _json()
    formats: list[str] = _json()
    priority: int = 0
    added_at: datetime = Field(default_factory=now)


class Run(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    item_id: int = Field(foreign_key="item.id", index=True)
    run_no: int = 1
    status: str | None = None
    status_source: str = "user"  # user | derived
    started_on: date | None = None
    finished_on: date | None = None
    date_precision: str = "day"  # day | month | year | unknown
    progress: dict = _json(dict)
    goal: str | None = None  # games: main | main_extras | completionist
    variant: dict = _json(dict)  # platform, edition, format
    rating: float | None = Field(default=None, gt=0, le=10)  # same 0–10 scale as movie watches
    review: str | None = None
    updated_at: datetime = Field(default_factory=now)


class Event(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    item_id: int = Field(foreign_key="item.id", index=True)
    run_id: int | None = Field(default=None, foreign_key="run.id", index=True)
    episode_id: int | None = Field(default=None, foreign_key="episode.id", index=True)
    kind: str  # episode_watched | progress | session | status_change | rating
    occurred_at: datetime = Field(default_factory=now, index=True)
    date_precision: str = "day"
    payload: dict = _json(dict)


class Follow(SQLModel, table=True):
    """Explicit follows: a book author or series (announcements), or a muted item (notify=False)."""
    id: int | None = Field(default=None, primary_key=True)
    target_kind: str  # item | author | series
    target_id: str
    name: str | None = None
    notify: bool = True
    created_at: datetime = Field(default_factory=now)


class Notification(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    item_id: int | None = Field(default=None, index=True)
    episode_id: int | None = None
    type: str  # episode_aired | season_announced | date_moved | renewed | canceled | ended | digital_release | book_announced | released | dlc
    payload: dict = _json(dict)  # title, text, path (where clicking goes), push (deliver outside the app)
    dedupe_key: str = Field(unique=True)
    created_at: datetime = Field(default_factory=now, index=True)
    seen_at: datetime | None = None
    delivered_desktop_at: datetime | None = None
    delivered_push_at: datetime | None = None


class SyncState(SQLModel, table=True):
    provider: str = Field(primary_key=True)
    job: str = Field(primary_key=True)
    last_run_at: datetime | None = None
    cursor: dict = _json(dict)


class MediaCandidate(SQLModel, table=True):
    """The current recommendation slate per medium (shows, books, games)."""
    item_id: int = Field(primary_key=True, foreign_key="item.id")
    kind: str = Field(index=True)
    score: float
    rank: int
    because: list[int] = _json()
    reasons: list[str] = _json()
    sources: list[str] = _json()
    model: str = "cosine"
    computed_at: datetime = Field(default_factory=now)
