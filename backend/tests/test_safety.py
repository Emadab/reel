"""Phase 1 safety net: snapshots, the pre-migration backup guard and feature flags."""
import sqlite3

from sqlmodel import SQLModel

from app import backup, db
from app.config import settings
from conftest import drain, log


def test_snapshot_restore_roundtrip(client):
    log(client, 329865, "2026-08-23", 9)
    snap = backup.snapshot("test")
    assert (snap / "movies.db").is_file() and (snap / "media").is_dir()
    log(client, 843, "2026-08-24", 7)
    drain(client)  # like the restore script, nothing may hold the database open
    db.engine.dispose()
    backup.restore(snap)
    db.reconnect()
    assert client.get("/api/library").json()["counts"]["watched"] == 1


def test_migrate_backs_up_before_schema_change(client):
    before = set(backup.backups_dir().glob("*-pre-migration"))
    db.migrate()  # nothing to change: no snapshot
    assert set(backup.backups_dir().glob("*-pre-migration")) == before
    with sqlite3.connect(settings.db_path) as c:
        c.execute("DROP TABLE importjob")  # simulate an older database missing a table
    db.engine.dispose()
    db.migrate()
    assert len(set(backup.backups_dir().glob("*-pre-migration")) - before) == 1
    assert "importjob" in SQLModel.metadata.tables


def test_flags_default_off_and_toggle(client):
    flags = client.get("/api/settings").json()["flags"]
    assert flags == {"media.shows": False, "media.books": False, "media.games": False, "announcements": False}
    assert client.put("/api/settings", json={"flags": {"media.shows": True}}).json()["flags"]["media.shows"] is True
    assert client.put("/api/settings", json={"flags": {"nope": True}}).status_code == 422
