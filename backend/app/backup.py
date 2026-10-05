"""Local snapshots of the database and images: data/backups/<timestamp>/{movies.db, media/}.
Taken by scripts/backup.py and automatically by db.migrate() before any schema change."""
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

from .config import settings


def backups_dir() -> Path:
    return settings.data_dir / "backups"


def snapshot(reason: str = "manual") -> Path:
    out = backups_dir() / f"{datetime.now():%Y%m%d-%H%M%S}-{reason}"
    out.mkdir(parents=True, exist_ok=True)
    src, dst = sqlite3.connect(settings.db_path), sqlite3.connect(out / "movies.db")
    with dst:
        src.backup(dst)  # consistent copy even while the app is writing
    src.close()
    dst.close()
    if settings.media_dir.exists():
        shutil.copytree(settings.media_dir, out / "media", dirs_exist_ok=True)
    return out


def restore(snap: Path) -> None:
    """Copy a snapshot back over the live data. The app must not be running."""
    if not (snap / "movies.db").is_file():
        raise SystemExit(f"{snap} is not a Reel snapshot")
    for suffix in ("", "-wal", "-shm"):
        Path(str(settings.db_path) + suffix).unlink(missing_ok=True)
    shutil.copy2(snap / "movies.db", settings.db_path)
    if (snap / "media").exists():
        shutil.rmtree(settings.media_dir, ignore_errors=True)
        shutil.copytree(snap / "media", settings.media_dir)
