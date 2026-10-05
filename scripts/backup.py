"""Snapshot the database and images into backend/data/backups/<timestamp>/.
Run from the repo root: uv run --project backend python scripts/backup.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.backup import snapshot  # noqa: E402

print(snapshot())
