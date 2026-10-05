"""Tables for shows, books and games (docs/expansion/REEL_EXPANSION.md §5.2). Movies keep their own tables."""
from datetime import datetime

from sqlmodel import Column, Field, LargeBinary, SQLModel

from .models import now


class HttpCache(SQLModel, table=True):
    key: str = Field(primary_key=True)
    url: str
    status: int
    etag: str | None = None
    body: bytes = Field(sa_column=Column(LargeBinary))
    fetched_at: datetime = Field(default_factory=now)
    ttl_s: int
