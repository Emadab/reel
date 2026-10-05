"""Notification centre, calendar and follows (flag `announcements`)."""
from datetime import UTC, date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, col, select

from .. import items
from ..db import get_session
from ..flags import KIND_FLAG, enabled, require_kind
from ..models_media import Episode, Follow, Item, LibraryEntry, Notification
from ..status import STICKY

router = APIRouter()


def _require(s: Session) -> None:
    if not enabled(s, "announcements"):
        raise HTTPException(404, "Not found")


def _out(n: Notification) -> dict:
    return {"id": n.id, "type": n.type, "title": n.payload.get("title"), "text": n.payload.get("text"),
            "path": n.payload.get("path"), "item_id": n.item_id, "created_at": items.utc(n.created_at).isoformat(),
            "seen": n.seen_at is not None}


@router.get("/notifications")
def notifications(s: Session = Depends(get_session)):
    _require(s)
    rows = s.exec(select(Notification).order_by(col(Notification.created_at).desc()).limit(60)).all()
    # a medium whose flag is off stays invisible here too
    kinds = {i.id: i.kind for i in s.exec(select(Item).where(col(Item.id).in_([n.item_id for n in rows if n.item_id])))}
    rows = [n for n in rows if not n.item_id or enabled(s, KIND_FLAG.get(kinds.get(n.item_id, ""), "announcements"))]
    return {"unseen": sum(1 for n in rows if n.seen_at is None), "items": [_out(n) for n in rows]}


class SeenIn(BaseModel):
    ids: list[int] | None = None  # None: all


@router.post("/notifications/seen", status_code=204)
def seen(body: SeenIn, s: Session = Depends(get_session)):
    _require(s)
    q = select(Notification).where(col(Notification.seen_at).is_(None))
    if body.ids is not None:
        q = q.where(col(Notification.id).in_(body.ids))
    stamp = datetime.now(UTC)
    for n in s.exec(q):
        n.seen_at = stamp
        s.add(n)
    s.commit()


@router.get("/media/{kind}/calendar")
def calendar(kind: Literal["show", "book", "game"], days: int = 90, s: Session = Depends(get_session)):
    """What's coming for things in your library: episodes, and release dates of wishlisted books and games."""
    require_kind(s, kind)
    start, end = datetime.now(UTC) - timedelta(days=7), datetime.now(UTC) + timedelta(days=days)
    out = []
    rows = s.exec(select(Item, LibraryEntry).join(LibraryEntry, col(LibraryEntry.item_id) == col(Item.id)).where(Item.kind == kind)).all()
    for item, entry in rows:
        if entry.shelf == "not_interested":
            continue
        run = items.current_run(s, item.id)  # type: ignore[arg-type]
        if run and run.status in STICKY:
            continue
        card = items.card(s, item, entry, run)
        if kind == "show":
            for e in s.exec(select(Episode).where(Episode.item_id == item.id, Episode.is_special == False,  # noqa: E712
                                                  col(Episode.airstamp_utc).is_not(None))):
                stamp = items.utc(e.airstamp_utc)  # type: ignore[arg-type]
                if start <= stamp <= end:
                    out.append({"at": stamp.isoformat(), "day": stamp.date().isoformat(), "item": card,
                                "label": f"S{e.season} · E{e.number}", "title": e.title, "aired": stamp <= datetime.now(UTC)})
        elif item.release_date and start.date() <= item.release_date <= end.date():
            out.append({"at": item.release_date.isoformat(), "day": item.release_date.isoformat(), "item": card,
                        "label": "Release", "title": None, "aired": item.release_date <= date.today()})
    out.sort(key=lambda x: x["at"])
    return out


# ---- follows ----

class ItemFollowIn(BaseModel):
    notify: bool | None = None  # False mutes announcements for this item
    priority: bool | None = None  # True: alerts go to the desktop/phone at air time


@router.post("/media/items/{item_id}/follow")
def follow_item(item_id: int, body: ItemFollowIn, s: Session = Depends(get_session)):
    _require(s)
    item = items.get_item(s, item_id)
    require_kind(s, item.kind)
    if body.notify is not None:
        f = s.exec(select(Follow).where(Follow.target_kind == "item", Follow.target_id == str(item_id))).first()
        f = f or Follow(target_kind="item", target_id=str(item_id), name=item.title)
        f.notify = body.notify
        s.add(f)
    if body.priority is not None:
        entry = items.library_entry(s, item)
        entry.priority = 1 if body.priority else 0
        s.add(entry)
    s.commit()
    return follow_state(s, item_id)


def follow_state(s: Session, item_id: int) -> dict:
    f = s.exec(select(Follow).where(Follow.target_kind == "item", Follow.target_id == str(item_id))).first()
    entry = s.get(LibraryEntry, item_id)
    return {"notify": not f or f.notify, "priority": bool(entry and entry.priority > 0)}


class FollowIn(BaseModel):
    target_kind: Literal["author", "series"]
    target_id: str
    name: str


@router.get("/follows")
def follows(s: Session = Depends(get_session)):
    _require(s)
    return [{"id": f.id, "target_kind": f.target_kind, "target_id": f.target_id, "name": f.name}
            for f in s.exec(select(Follow).where(col(Follow.target_kind).in_(["author", "series"])))]


@router.post("/follows")
def add_follow(body: FollowIn, s: Session = Depends(get_session)):
    _require(s)
    require_kind(s, "book")
    f = s.exec(select(Follow).where(Follow.target_kind == body.target_kind, Follow.target_id == body.target_id)).first()
    if not f:
        f = Follow(target_kind=body.target_kind, target_id=body.target_id, name=body.name)
        s.add(f)
        s.commit()
    return follows(s)


@router.delete("/follows/{follow_id}", status_code=204)
def remove_follow(follow_id: int, s: Session = Depends(get_session)):
    _require(s)
    if f := s.get(Follow, follow_id):
        s.delete(f)
        s.commit()
