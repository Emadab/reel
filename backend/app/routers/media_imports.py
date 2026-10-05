"""Import review for shows and books: upload, match in the background, fix rows, commit."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import Session

from .. import db, jobs, media_import
from ..db import get_session
from ..flags import require_kind
from ..models import ImportJob
from ..providers.http import ProviderUnavailable

router = APIRouter(prefix="/media/import")


def _job(s: Session, job_id: int) -> ImportJob:
    j = s.get(ImportJob, job_id)
    if not j or j.source not in media_import.SOURCES:
        raise HTTPException(404, "Import not found")
    require_kind(s, media_import.SOURCES[j.source])
    return j


def _summary(rows: list[dict]) -> dict:
    out = {"matched": 0, "ambiguous": 0, "unmatched": 0}
    for r in rows:
        if r.get("status") in out:
            out[r["status"]] += 1
    out["included"] = sum(1 for r in rows if r.get("include") and r.get("ext_id"))
    return out


@router.post("/{source}")
async def upload(source: Literal["goodreads", "storygraph", "imdb_tv"], files: list[UploadFile], s: Session = Depends(get_session)):
    require_kind(s, media_import.SOURCES[source])
    raw = media_import.parse(source, await files[0].read())
    job = ImportJob(source=source, rows=[{"raw": r, "status": "pending"} for r in raw])
    s.add(job)
    s.commit()
    job_id = job.id

    async def run() -> None:
        out = []
        for n, r in enumerate(raw):
            try:
                out.append({"raw": r, **await media_import.match(source, r)})
            except (ProviderUnavailable, HTTPException):
                out.append({"raw": r, "status": "unmatched", "ext_id": None, "include": False, "options": []})
            jobs.progress(f"import:{job_id}", n + 1, len(raw))
        with Session(db.engine) as s2:
            j = s2.get(ImportJob, job_id)
            j.rows = out  # type: ignore[union-attr]
            s2.add(j)
            s2.commit()

    jobs.enqueue(f"import:{job_id}", run)
    return {"job_id": job_id, "rows": len(raw)}


@router.get("/{job_id}")
def get_job(job_id: int, s: Session = Depends(get_session)):
    j = _job(s, job_id)
    st = jobs.status.get(f"import:{job_id}", {"state": "done", "done": len(j.rows), "total": len(j.rows)})
    return {"id": j.id, "source": j.source, "committed": j.committed, "state": st["state"],
            "progress": {"done": st["done"], "total": st["total"] or len(j.rows)}, "summary": _summary(j.rows), "rows": j.rows}


class RowPatch(BaseModel):
    ext_id: str | None = None
    include: bool | None = None


@router.patch("/{job_id}/rows/{i}")
def patch_row(job_id: int, i: int, body: RowPatch, s: Session = Depends(get_session)):
    j = _job(s, job_id)
    if not 0 <= i < len(j.rows):
        raise HTTPException(404, "Row not found")
    row = j.rows[i]
    if body.ext_id is not None:
        row.update(ext_id=body.ext_id, status="matched", include=True)
    if body.include is not None:
        row["include"] = body.include and bool(row.get("ext_id"))
    flag_modified(j, "rows")
    s.add(j)
    s.commit()
    return {"row": row, "summary": _summary(j.rows)}


@router.post("/{job_id}/commit")
async def commit(job_id: int, s: Session = Depends(get_session)):
    j = _job(s, job_id)
    kind = media_import.SOURCES[j.source]
    rows = [r for r in j.rows if r.get("include") and r.get("ext_id")]
    created = 0
    for r in rows:
        try:
            created += await media_import.commit_row(s, kind, r["raw"], r["ext_id"])
        except (ProviderUnavailable, HTTPException):
            continue
    j.committed = True
    s.add(j)
    s.commit()
    return {"created": created, "skipped": len(rows) - created}
