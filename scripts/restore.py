"""Restore a snapshot made by scripts/backup.py. Close Reel first.
Run from the repo root: uv run --project backend python scripts/restore.py [snapshot-dir]  (default: newest)"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.backup import backups_dir, restore  # noqa: E402

snaps = sorted(p for p in backups_dir().glob("*") if p.is_dir())
target = Path(sys.argv[1]) if len(sys.argv) > 1 else (snaps[-1] if snaps else None)
if target is None:
    raise SystemExit("no snapshots in " + str(backups_dir()))
restore(target)
print("restored", target)
