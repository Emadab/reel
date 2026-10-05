import shutil
import sqlite3
import tempfile
import zipfile
from datetime import date
from pathlib import Path

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlmodel import Session

from .. import db, jobs, tmdb
from ..config import set_env, settings
from ..db import get_session, get_setting, put_setting

router = APIRouter()
ACCENTS = ["#7FDBFF", "#C6F36B", "#FFB86B", "#C9A7FF"]


@router.get("/health")
def health():
    return {"ok": True}


@router.get("/system/jobs")
def job_status():
    return jobs.status


class SettingsIn(BaseModel):
    accent: str | None = None
    tmdb_token: str | None = None
    omdb_key: str | None = None
    data_dir: str | None = None


async def _check_tmdb(token: str) -> bool:
    try:
        r = await tmdb.api.get("/configuration", headers={"Authorization": f"Bearer {token}"})
    except httpx.HTTPError:
        raise HTTPException(503, "TMDB unreachable. Check your connection.")
    return r.status_code == 200


def _out(s: Session, tmdb_ok: bool | None = None) -> dict:
    """Key presence only; key values never leave the backend."""
    return {
        "accent": get_setting(s, "accent", ACCENTS[0]),
        "accents": ACCENTS,
        "data_dir": str(settings.data_dir),
        "tmdb_configured": bool(settings.tmdb_token),
        "tmdb_connected": tmdb_ok,
        "omdb_configured": bool(settings.omdb_key),
    }


@router.get("/settings")
def get_settings(s: Session = Depends(get_session)):
    return _out(s)


@router.post("/settings/test")
async def test_tmdb(s: Session = Depends(get_session)):
    ok = bool(settings.tmdb_token) and await _check_tmdb(settings.tmdb_token)
    return _out(s, ok)


@router.put("/settings")
async def put_settings(body: SettingsIn, s: Session = Depends(get_session)):
    restart = False
    ok = None
    if body.accent is not None:
        if body.accent.upper() not in ACCENTS:
            raise HTTPException(422, "Unknown accent")
        put_setting(s, "accent", body.accent.upper())
    if body.tmdb_token:
        token = body.tmdb_token.strip()
        if not await _check_tmdb(token):
            raise HTTPException(422, "TMDB rejected that token. Copy the long 'API Read Access Token'.")
        set_env("TMDB_TOKEN", token)
        ok = True
    if body.omdb_key is not None:
        set_env("OMDB_KEY", body.omdb_key.strip())
    if body.data_dir and Path(body.data_dir).resolve() != settings.data_dir:
        Path(body.data_dir).mkdir(parents=True, exist_ok=True)
        set_env("DATA_DIR", body.data_dir)
        restart = True
    return {**_out(s, ok), "restart_required": restart}


def _backup_zip() -> Path:
    tmp = Path(tempfile.mkdtemp())
    snapshot = tmp / "movies.db"
    src = sqlite3.connect(settings.db_path)
    dst = sqlite3.connect(snapshot)
    src.backup(dst)  # consistent copy even while the app is writing
    src.close()
    dst.close()
    out = tmp / f"reel-backup-{date.today():%Y%m%d}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(snapshot, "movies.db")
        for folder in (settings.media_dir, settings.models_dir):
            for f in folder.rglob("*"):
                if f.is_file():
                    z.write(f, f.relative_to(settings.data_dir).as_posix(), compress_type=zipfile.ZIP_STORED)
    snapshot.unlink()
    return out


@router.get("/system/backup")
async def backup(tasks: BackgroundTasks):
    import asyncio

    out = await asyncio.to_thread(_backup_zip)
    tasks.add_task(shutil.rmtree, out.parent, True)
    return FileResponse(out, filename=out.name, media_type="application/zip")


@router.post("/system/restore")
async def restore(file: UploadFile):
    tmp = Path(tempfile.mkdtemp())
    try:
        archive = tmp / "backup.zip"
        archive.write_bytes(await file.read())
        try:
            z = zipfile.ZipFile(archive)
        except zipfile.BadZipFile:
            raise HTTPException(422, "That file isn't a zip")
        with z:
            names = z.namelist()
            if "movies.db" not in names or any(n.startswith(("/", "..")) or ".." in n.split("/") for n in names):
                raise HTTPException(422, "That zip isn't a Reel backup")
            z.extractall(tmp / "x")
        db.engine.dispose()
        for suffix in ("", "-wal", "-shm"):
            Path(str(settings.db_path) + suffix).unlink(missing_ok=True)
        shutil.move(tmp / "x" / "movies.db", settings.db_path)
        for sub in ("media", "models"):
            if (tmp / "x" / sub).exists():
                shutil.rmtree(settings.data_dir / sub, ignore_errors=True)
                shutil.move(tmp / "x" / sub, settings.data_dir / sub)
        settings.reload()
        db.reconnect()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return {"ok": True}
