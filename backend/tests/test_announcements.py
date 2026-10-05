"""Announcements: the diff engine (new season, date moved, aired, renewal, cancellation), idempotent jobs,
same-day collapsing, sticky runs getting no alerts, quiet hours with a digest, and the notification API."""
import asyncio
from datetime import UTC, date, datetime, timedelta

from sqlmodel import Session, select

from app import announce, db, items, notify
from app.models_media import Follow, Item, Notification
from app.providers import openlibrary, rawg
from app.providers.base import EpisodeData, ItemData, SearchHit
from test_media import SHOW, media  # noqa: F401  (fixture)

NOW = datetime(2026, 10, 5, 20, 0, tzinfo=UTC)


def run(coro):
    return asyncio.run(coro)


def notes(s: Session) -> list[Notification]:
    return list(s.exec(select(Notification).order_by(Notification.id)))


def add_show(c, **kw) -> int:
    return c.post("/api/media/show/items", json={"ext_id": "95396", "shelf": "wishlist", **kw}).json()["id"]


def test_diff_engine_cases(media):  # noqa: F811
    item_id = add_show(media)
    with Session(db.engine) as s:
        item = s.get(Item, item_id)
        base = announce.snapshot(s, item)
        ep = base["episodes"][(2, 1)]
        later = datetime(2099, 2, 1, tzinfo=UTC)
        after = {"status": "canceled", "seasons": base["seasons"] + [3],
                 "episodes": {**base["episodes"], (2, 1): (ep[0], later)}}
        assert announce.diff_show(s, item, base, after) == 3  # season 3, canceled, S2E1 moved
        assert announce.diff_show(s, item, base, after) == 0  # idempotent
        revived = {**after, "status": "returning", "seasons": after["seasons"] + [4]}
        assert announce.diff_show(s, item, {**after, "status": "ended"}, revived) == 2  # renewed + season 4
        types = [n.type for n in notes(s)]
        assert types == ["season_announced", "canceled", "date_moved", "season_announced", "renewed"]
        assert notes(s)[0].payload["path"] == f"/shows/{item_id}"
        s.commit()


def test_airing_collapses_same_day_and_is_idempotent(media):  # noqa: F811
    SHOW["future_ep"] = False
    item_id = add_show(media)
    with Session(db.engine) as s:
        # S1E1 and S1E2 air on the same day (move E2 onto E1's day)
        from app.models_media import Episode

        eps = s.exec(select(Episode).where(Episode.item_id == item_id, Episode.season == 1)).all()
        for e in eps:
            e.airstamp_utc = NOW - timedelta(hours=2 - e.number * 0.5)
            s.add(e)
        s.commit()
        announce.state(s, "reel", "airing").last_run_at = NOW - timedelta(hours=6)
        s.commit()
        assert announce.airing(s, at=NOW) == 2
        n = notes(s)
        assert len(n) == 1 and n[0].payload["text"] == "2 new episodes are out" and n[0].payload["push"] is False
        announce.state(s, "reel", "airing").last_run_at = NOW - timedelta(hours=6)
        announce.airing(s, at=NOW)
        assert len(notes(s)) == 1  # running twice creates nothing new


def test_sticky_and_muted_shows_get_no_alerts(media):  # noqa: F811
    item_id = add_show(media)
    media.post(f"/api/media/items/{item_id}/status", json={"status": "watching"})
    media.post(f"/api/media/items/{item_id}/status", json={"status": "dropped"})
    with Session(db.engine) as s:
        assert announce.followed(s, "show") == []
    media.post(f"/api/media/items/{item_id}/status", json={"status": "watching"})
    with Session(db.engine) as s:
        assert len(announce.followed(s, "show")) == 1
        s.add(Follow(target_kind="item", target_id=str(item_id), notify=False))
        s.commit()
        assert announce.followed(s, "show") == []


def test_show_updates_refreshes_followed_and_diffs(media, monkeypatch):  # noqa: F811
    item_id = add_show(media)
    SHOW["status"] = "canceled"

    async def changed(since):
        return set()

    monkeypatch.setattr(announce.tvmaze, "changed_since", changed)
    with Session(db.engine) as s:
        assert run(announce.show_updates(s)) == 1  # first run refreshes everything: canceled
        assert run(announce.show_updates(s)) == 0  # feed says nothing changed, item is fresh
        assert notes(s)[0].dedupe_key == f"show:{item_id}:canceled"


def test_quiet_hours_hold_then_digest(media, monkeypatch):  # noqa: F811
    sent: list[tuple[str, str]] = []
    monkeypatch.setattr(notify, "toast", lambda t, x: sent.append((t, x)))
    media.put("/api/settings", json={"quiet_hours": "00:00-23:59"})
    with Session(db.engine) as s:
        for i in range(5):
            notify.add(s, f"k{i}", "released", f"Thing {i}", "Out now", None)
        s.commit()
        assert run(notify.deliver(s)) == 0 and sent == []
    media.put("/api/settings", json={"quiet_hours": ""})
    with Session(db.engine) as s:
        assert run(notify.deliver(s)) == 1
        assert sent[0][0] == "Reel · 5 updates"
        assert run(notify.deliver(s)) == 0  # delivered once
    assert media.put("/api/settings", json={"quiet_hours": "late"}).status_code == 422


def test_quiet_window_wraps_midnight(media):  # noqa: F811
    media.put("/api/settings", json={"quiet_hours": "23:00-08:00"})
    with Session(db.engine) as s:
        assert notify.quiet_now(s, datetime(2026, 1, 1, 2, 0))
        assert not notify.quiet_now(s, datetime(2026, 1, 1, 12, 0))


def test_movie_digital_release(media, monkeypatch):  # noqa: F811
    media.post("/api/watchlist/329865")

    async def fake_get(path, **kw):
        assert path == "/movie/329865/release_dates"
        return {"results": [{"iso_3166_1": "US", "release_dates": [{"type": 3, "release_date": "2026-08-01T00:00:00Z"},
                                                                   {"type": 4, "release_date": "2026-09-20T00:00:00Z"}]}]}

    monkeypatch.setattr(announce.tmdb, "get", fake_get)
    with Session(db.engine) as s:
        assert run(announce.movie_releases(s, today=date(2026, 10, 5))) == 1
        assert run(announce.movie_releases(s, today=date(2026, 10, 5))) == 0
        assert notes(s)[0].payload["path"] == "/film/329865"


def test_followed_author_new_book(media, monkeypatch):  # noqa: F811
    works = [SearchHit("book", "openlibrary", "OL1W", "Piranesi", 2020)]

    async def fake_works(author_id):
        return list(works)

    monkeypatch.setattr(openlibrary, "author_works", fake_works)
    media.put("/api/settings", json={"flags": {"announcements": True}})
    media.post("/api/follows", json={"target_kind": "author", "target_id": "OL1A", "name": "Susanna Clarke"})
    with Session(db.engine) as s:
        assert run(announce.book_follows(s)) == 0  # first run learns what exists
        works.append(SearchHit("book", "openlibrary", "OL2W", "The Wood at Midwinter", 2024))
        assert run(announce.book_follows(s)) == 1
        assert run(announce.book_follows(s)) == 0
        assert notes(s)[0].payload["text"] == "New from Susanna Clarke"


def test_wishlisted_game_date_move_release_and_dlc(media, monkeypatch):  # noqa: F811
    release = {"date": date(2026, 12, 1), "dlc": []}

    async def fake_game(ext_id, kind="game"):
        return ItemData(kind="game", title="Hollow Knight: Silksong", external_ids={"rawg": ext_id}, release_date=release["date"],
                        status="upcoming", details={"playtime_hours": 30, "dlc": release["dlc"]})

    monkeypatch.setattr(rawg, "fetch", fake_game)
    item_id = media.post("/api/media/game/items", json={"ext_id": "9", "shelf": "wishlist"}).json()["id"]
    with Session(db.engine) as s:
        release["date"] = date(2027, 2, 1)
        assert run(announce.game_releases(s, today=date(2026, 10, 5))) == 1  # date moved
        release["date"] = date(2026, 10, 1)
        assert run(announce.game_releases(s, today=date(2026, 10, 5))) == 1  # released
        assert run(announce.game_releases(s, today=date(2026, 10, 5))) == 0
    media.post(f"/api/media/items/{item_id}/runs", json={"status": "beaten"})
    release["dlc"] = [{"rawg": "77", "name": "Sea of Sorrow", "released": None}]
    with Session(db.engine) as s:
        assert run(announce.game_releases(s, today=date(2026, 10, 5))) == 1
        assert [n.type for n in notes(s)] == ["date_moved", "released", "dlc"]


def test_notification_api_and_flag(media):  # noqa: F811
    assert media.get("/api/notifications").status_code == 404
    media.put("/api/settings", json={"flags": {"announcements": True}})
    item_id = add_show(media)
    with Session(db.engine) as s:
        notify.add(s, "x", "released", "Severance", "Out now", f"/shows/{item_id}", item_id)
        s.commit()
    r = media.get("/api/notifications").json()
    assert r["unseen"] == 1 and r["items"][0]["path"] == f"/shows/{item_id}"
    media.post("/api/notifications/seen", json={})
    assert media.get("/api/notifications").json()["unseen"] == 0
    d = media.post(f"/api/media/items/{item_id}/follow", json={"priority": True}).json()
    assert d == {"notify": True, "priority": True}
    assert media.get(f"/api/media/items/{item_id}").json()["follow"]["priority"] is True
    cal = media.get("/api/media/show/calendar").json()
    assert all(c["item"]["id"] == item_id for c in cal)
    media.put("/api/settings", json={"flags": {"media.shows": False}})
    assert media.get("/api/notifications").json()["items"] == []  # a disabled medium's news is hidden too
    assert items  # keeps the import used
