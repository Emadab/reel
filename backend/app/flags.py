"""Feature flags (docs/expansion/REEL_EXPANSION.md §3), stored as setting rows `flag:<name>`, all off by default.
The doc's core.* flags are absent: movies keep their own tables (lean path, see the Phase 1 report)."""
from fastapi import HTTPException
from sqlmodel import Session

from .db import get_setting, put_setting

FLAGS = ("media.shows", "media.books", "media.games", "announcements")
KIND_FLAG = {"show": "media.shows", "book": "media.books", "game": "media.games"}


def enabled(s: Session, name: str) -> bool:
    return get_setting(s, f"flag:{name}") == "1"


def all_flags(s: Session) -> dict[str, bool]:
    return {f: enabled(s, f) for f in FLAGS}


def set_flag(s: Session, name: str, on: bool) -> None:
    if name not in FLAGS:
        raise HTTPException(422, f"Unknown flag {name}")
    put_setting(s, f"flag:{name}", "1" if on else "0")


def require_kind(s: Session, kind: str) -> None:
    """404 for a medium whose flag is off, so a disabled medium is invisible to the API too."""
    if kind not in KIND_FLAG or not enabled(s, KIND_FLAG[kind]):
        raise HTTPException(404, "Not found")
