"""Letterboxd and IMDb CSV import (PRODUCT_SPEC §8).
Letterboxd export columns: diary.csv = Date, Name, Year, Letterboxd URI, Rating, Rewatch, Tags, Watched Date;
ratings.csv = Date, Name, Year, Letterboxd URI, Rating. IMDb ratings.csv = Const, Your Rating, Date Rated, Title,
..., Title Type, ..., Year."""
import asyncio
import csv
import io
import zipfile
from datetime import date

from fastapi import HTTPException

from . import tmdb
from .routers.search import thumb_url


def _csv(data: bytes) -> list[dict[str, str]]:
    text = data.decode("utf-8-sig", errors="replace")
    return [{(k or "").strip(): (v or "").strip() for k, v in row.items()} for row in csv.DictReader(io.StringIO(text))]


def _float(v: str) -> float | None:
    try:
        return float(v) if v else None
    except ValueError:
        return None


def _date(v: str) -> date | None:
    try:
        return date.fromisoformat(v[:10]) if v else None
    except ValueError:
        return None


def letterboxd_files(files: dict[str, bytes]) -> dict[str, bytes]:
    """Accepts the export zip or loose CSVs; returns {"diary.csv": ..., "ratings.csv": ...}."""
    out: dict[str, bytes] = {}
    for name, data in files.items():
        if name.lower().endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                for n in z.namelist():
                    base = n.rsplit("/", 1)[-1].lower()
                    if base in ("diary.csv", "ratings.csv") and "/" not in n.strip("/"):
                        out[base] = z.read(n)
        else:
            out[name.rsplit("/", 1)[-1].lower()] = data
    return out


def parse_letterboxd(files: dict[str, bytes]) -> list[dict]:
    f = letterboxd_files(files)
    if "diary.csv" not in f and "ratings.csv" not in f:
        raise HTTPException(422, "Couldn't find diary.csv or ratings.csv in that upload")
    rows: list[dict] = []
    in_diary: set[tuple[str, str]] = set()
    for r in _csv(f.get("diary.csv", b"")):
        d = _date(r.get("Watched Date", "")) or _date(r.get("Date", ""))
        if not r.get("Name") or not d:
            continue
        in_diary.add((r["Name"], r.get("Year", "")))
        rows.append({"title": r["Name"], "year": r.get("Year") or None, "watched_on": d.isoformat(),
                     "date_precision": "day", "rating": _float(r.get("Rating", "")),
                     "is_rewatch": r.get("Rewatch", "").lower() == "yes"})
    for r in _csv(f.get("ratings.csv", b"")):
        d = _date(r.get("Date", ""))
        if not r.get("Name") or not d or (r["Name"], r.get("Year", "")) in in_diary:
            continue
        rows.append({"title": r["Name"], "year": r.get("Year") or None, "watched_on": date(d.year, 1, 1).isoformat(),
                     "date_precision": "year", "rating": _float(r.get("Rating", "")), "is_rewatch": False})
    return rows


def parse_imdb(data: bytes) -> list[dict]:
    rows = []
    for r in _csv(data):
        kind = r.get("Title Type", "").replace(" ", "").lower()
        if kind and kind not in ("movie", "tvmovie"):
            continue
        d = _date(r.get("Date Rated", "")) or _date(r.get("Created", ""))
        score = _float(r.get("Your Rating", ""))
        if not r.get("Const") or not d:
            continue
        rows.append({"title": r.get("Title", ""), "year": r.get("Year") or None, "imdb_id": r["Const"],
                     "watched_on": date(d.year, 1, 1).isoformat(), "date_precision": "year",
                     "rating": round(score) / 2 if score else None, "is_rewatch": False})
    return rows


def _option(r: dict) -> dict:
    return {"tmdb_id": r["id"], "title": r["title"], "year": tmdb._year(r.get("release_date")),
            "poster_sm": thumb_url(r["id"], r.get("poster_path"))}


async def match(raw: dict, source: str) -> dict:
    row = {"raw": raw, "status": "unmatched", "tmdb_id": None, "options": [], "include": False}
    try:
        if source == "imdb":
            hit = await tmdb.find_imdb(raw["imdb_id"])
            if hit:
                row.update(status="matched", tmdb_id=hit["id"], options=[_option(hit)], include=True)
            return row
        results = (await tmdb.get("/search/movie", query=raw["title"], include_adult="false"))["results"]
    except HTTPException:
        return row
    year = int(raw["year"]) if raw.get("year") and str(raw["year"]).isdigit() else None
    options = [_option(r) for r in results[:3]]
    top = options[0] if options else None
    if top and year and top["year"] and abs(top["year"] - year) <= 1:
        row.update(status="matched", tmdb_id=top["tmdb_id"], options=options, include=True)
    elif options:
        row.update(status="ambiguous", options=options)
    return row


async def match_all(rows: list[dict], source: str, progress=None) -> list[dict]:
    done = 0

    async def one(r: dict) -> dict:
        nonlocal done
        out = await match(r, source)
        done += 1
        if progress:
            progress(done, len(rows))
        return out

    return await asyncio.gather(*(one(r) for r in rows))
