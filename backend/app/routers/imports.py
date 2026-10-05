from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import Session, select

from .. import db, importers, jobs, tmdb
from ..cards import fix_rewatches
from ..db import get_session
from ..models import ImportJob, Watch
from ..recommender import service

router = APIRouter()


class RowPatch(BaseModel):
    tmdb_id: int | None = None
    include: bool | None = None


def _job(s: Session, job_id: int) -> ImportJob:
    j = s.get(ImportJob, job_id)
    if not j:
        raise HTTPException(404, "Import not found")
    return j


def _summary(rows: list[dict]) -> dict:
    out = {"matched": 0, "ambiguous": 0, "unmatched": 0}
    for r in rows:
        if r.get("status") in out:
            out[r["status"]] += 1
    out["included"] = sum(1 for r in rows if r.get("include") and r.get("tmdb_id"))
    return out


@router.post("/import/{source}")
async def upload(source: Literal["letterboxd", "imdb"], files: list[UploadFile], s: Session = Depends(get_session)):
    data = {f.filename or "upload.csv": await f.read() for f in files}
    raw = importers.parse_letterboxd(data) if source == "letterboxd" else importers.parse_imdb(next(iter(data.values())))
    if not raw:
        raise HTTPException(422, "No films found in that file")
    job = ImportJob(source=source, rows=[{"raw": r, "status": "pending"} for r in raw])
    s.add(job)
    s.commit()
    job_id = job.id

    async def run() -> None:
        rows = await importers.match_all(raw, source, progress=lambda d, t: jobs.progress(f"import:{job_id}", d, t))
        with Session(db.engine) as s2:
            j = s2.get(ImportJob, job_id)
            j.rows = rows  # type: ignore[union-attr]
            s2.add(j)
            s2.commit()

    jobs.enqueue(f"import:{job_id}", run)
    return {"job_id": job_id, "rows": len(raw)}


@router.get("/import/{job_id}")
def get_job(job_id: int, s: Session = Depends(get_session)):
    j = _job(s, job_id)
    st = jobs.status.get(f"import:{job_id}", {"state": "done", "done": len(j.rows), "total": len(j.rows)})
    return {"id": j.id, "source": j.source, "committed": j.committed, "state": st["state"],
            "progress": {"done": st["done"], "total": st["total"] or len(j.rows)},
            "summary": _summary(j.rows), "rows": j.rows}


@router.patch("/import/{job_id}/rows/{i}")
def patch_row(job_id: int, i: int, body: RowPatch, s: Session = Depends(get_session)):
    j = _job(s, job_id)
    if not 0 <= i < len(j.rows):
        raise HTTPException(404, "Row not found")
    row = j.rows[i]
    if body.tmdb_id is not None:
        row.update(tmdb_id=body.tmdb_id, status="matched", include=True)
    if body.include is not None:
        row["include"] = body.include and bool(row.get("tmdb_id"))
    flag_modified(j, "rows")
    s.add(j)
    s.commit()
    return {"row": row, "summary": _summary(j.rows)}


@router.post("/import/{job_id}/commit")
async def commit(job_id: int, s: Session = Depends(get_session)):
    j = _job(s, job_id)
    rows = [r for r in j.rows if r.get("include") and r.get("tmdb_id")]
    ids = list(dict.fromkeys(r["tmdb_id"] for r in rows))
    movies = await tmdb.ensure_movies(s, ids, images="none")  # images follow in the background
    created = 0
    for r in rows:
        if r["tmdb_id"] not in movies:
            continue
        raw = r["raw"]
        when = date.fromisoformat(raw["watched_on"])
        dupe = s.exec(select(Watch).where(
            Watch.tmdb_id == r["tmdb_id"], Watch.watched_on == when, Watch.source == j.source,
            Watch.rating == raw.get("rating") if raw.get("rating") is not None else Watch.rating.is_(None),  # type: ignore[union-attr]
        )).first()
        if dupe:
            continue
        s.add(Watch(tmdb_id=r["tmdb_id"], watched_on=when, date_precision=raw["date_precision"],
                    rating=raw.get("rating"), is_rewatch=raw.get("is_rewatch", False), source=j.source))
        created += 1
    j.committed = True
    s.add(j)
    s.commit()
    for i in ids:
        fix_rewatches(s, i)

    async def images() -> None:
        with Session(db.engine) as s2:
            for n, i in enumerate(ids):
                m = s2.get(tmdb.Movie, i)
                if m and await tmdb.ensure_images(m, "wall"):
                    s2.add(m)
                    s2.commit()
                jobs.progress("images", n + 1, len(ids))

    jobs.enqueue("images", images)
    service.request_recompute()
    return {"created": created, "skipped": len(rows) - created}
