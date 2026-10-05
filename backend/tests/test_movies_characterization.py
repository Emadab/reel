"""Characterization tests: pin every movie endpoint's response and database effects as they are today,
so the expansion (shows, books, games) can prove it never changes the movie experience.
Golden file: tests/golden/movies.json. Regenerate only on purpose: REEL_UPDATE_GOLDEN=1 uv run pytest -k characterization"""
import json
import shutil
import os
import re
from datetime import date
from pathlib import Path

from sqlmodel import Session, select

from app import db, tmdb
from app.config import settings
from app.models import Feedback, Watch, WatchlistItem
from app.recommender import candidates, ranker, service
from app.routers import history, search
from conftest import drain, log
from test_import_and_recs import DIARY, IMDB

GOLDEN = Path(__file__).parent / "golden" / "movies.json"
VOLATILE = re.compile(r"(_at|^version|^id|^job_id|^took_ms)$")


class Today(date):
    @classmethod
    def today(cls):
        return cls(2026, 10, 5)


def _clean(v):
    if isinstance(v, dict):
        return {k: ("<volatile>" if VOLATILE.search(k) else _clean(x)) for k, x in v.items()}
    if isinstance(v, list):
        if v and all(isinstance(x, dict) and set(x) == {"name", "count"} for x in v):
            # top-N lists built from sets: equal counts come out in hash order, so ties at the cut are unnamed
            low = min(x["count"] for x in v)
            return sorted(({"name": "<tie>" if x["count"] == low else x["name"], "count": x["count"]} for x in v),
                          key=lambda x: (-x["count"], x["name"]))
        return [_clean(x) for x in v]
    if isinstance(v, float):
        return round(v, 4)
    return v


def _scenario(c) -> dict:
    out: dict = {}

    def call(name: str, method: str, path: str, **kw):
        r = c.request(method, path, **kw)
        out[name] = {"status": r.status_code, "body": _clean(r.json()) if r.content and "json" in r.headers.get("content-type", "") else None}
        return r

    call("search", "GET", "/api/search", params={"q": "arrival"})
    call("search_short", "GET", "/api/search", params={"q": "a"})
    call("watchlist_add", "POST", "/api/watchlist/1398")
    call("watchlist_add_2", "POST", "/api/watchlist/593", params={"priority": 2})
    call("watchlist", "GET", "/api/watchlist")
    call("watchlist_remove", "DELETE", "/api/watchlist/593")
    w = log(c, 329865, "2026-08-23", 9.5, location="Home", with_whom="Sam", notes="Loved it")
    log(c, 329865, "2024-05-01", 8, precision="month")
    log(c, 335984, "2026-07-01", 10)
    log(c, 1398, "2019-01-01", 9, precision="year")
    log(c, 843, "2026-05-01", None)
    for i in range(20):
        log(c, 900000 + i, f"2025-{(i % 12) + 1:02d}-10", 4 if i % 2 == 0 else 7)
    drain(c)
    call("edit_watch", "PATCH", f"/api/watches/{w['id']}", json={"rating": 9, "notes": "Still loved it"})
    call("edit_watch_bad", "PATCH", f"/api/watches/{w['id']}", json={"rating": 11})
    extra = log(c, 11104, "2026-09-01", 6)
    call("delete_watch", "DELETE", f"/api/watches/{extra['id']}")
    call("delete_missing", "DELETE", "/api/watches/999999")
    call("recent", "GET", "/api/watches/recent")
    call("movie", "GET", "/api/movies/329865")
    call("movie_missing", "GET", "/api/movies/1")
    call("refresh", "POST", "/api/movies/335984/refresh")
    for tab in ("watched", "watchlist", "rewatches"):
        for sort in ("recent", "rating", "year", "title", "runtime"):
            call(f"library_{tab}_{sort}", "GET", "/api/library", params={"tab": tab, "sort": sort})
    call("library_filtered", "GET", "/api/library", params={"genre": "Science Fiction", "decade": 2010, "min_rating": 8})
    call("library_director", "GET", "/api/library", params={"director": "Denis Villeneuve"})
    call("facets", "GET", "/api/library/facets")
    for y in (2026, 2025, 2019):
        call(f"timeline_{y}", "GET", "/api/timeline", params={"year": y})
    call("years", "GET", "/api/timeline/years")
    for rng in ("all", "year", "30d", "90d"):
        call(f"stats_{rng}", "GET", "/api/stats", params={"range": rng})
    call("onboarding", "GET", "/api/onboarding")
    call("recompute", "POST", "/api/recommendations/recompute")
    drain(c)
    for f in ("all", "short", "wild"):
        call(f"recs_{f}", "GET", "/api/recommendations", params={"filter": f})
    call("feedback", "POST", "/api/feedback", json={"tmdb_id": 593, "signal": "not_interested"})
    call("feedback_undo", "DELETE", "/api/feedback/593/not_interested")
    call("feedback_like", "POST", "/api/feedback", json={"tmdb_id": 146233, "signal": "like"})
    call("tastemap", "GET", "/api/tastemap")
    call("explain", "GET", "/api/tastemap/explain/329865")
    call("delete_all", "DELETE", "/api/movies/843/watches")
    job = c.post("/api/import/letterboxd", files=[("files", ("diary.csv", DIARY, "text/csv"))]).json()["job_id"]
    drain(c)
    call("import_letterboxd", "GET", f"/api/import/{job}")
    call("import_commit", "POST", f"/api/import/{job}/commit")
    job = c.post("/api/import/imdb", files=[("files", ("ratings.csv", IMDB, "text/csv"))]).json()["job_id"]
    drain(c)
    call("import_imdb", "GET", f"/api/import/{job}")
    call("library_final", "GET", "/api/library")

    with Session(db.engine) as s:  # database effects
        out["db_watches"] = _clean([w.model_dump(exclude={"id", "created_at"}, mode="json") for w in s.exec(select(Watch).order_by(Watch.tmdb_id, Watch.watched_on))])
        out["db_watchlist"] = [(x.tmdb_id, x.priority) for x in s.exec(select(WatchlistItem).order_by(WatchlistItem.tmdb_id))]
        out["db_feedback"] = [(x.tmdb_id, x.signal) for x in s.exec(select(Feedback).order_by(Feedback.tmdb_id, Feedback.signal))]
    return out


def test_movie_behaviour_matches_golden(client, monkeypatch):
    # start from a cold process: earlier tests leave caches and a trained model behind
    search._directors.clear()
    tmdb._search_cache.clear()
    for folder in (settings.models_dir, settings.media_dir):
        shutil.rmtree(folder, ignore_errors=True)
        folder.mkdir()
    for mod in (candidates, ranker, service, history):
        monkeypatch.setattr(mod, "date", Today)
    got = json.loads(json.dumps(_scenario(client)))
    if os.getenv("REEL_UPDATE_GOLDEN") or not GOLDEN.exists():
        GOLDEN.write_text(json.dumps(got, indent=1, sort_keys=True), encoding="utf-8")
    want = json.loads(GOLDEN.read_text(encoding="utf-8"))
    if os.getenv("REEL_DUMP"):
        Path(os.environ["REEL_DUMP"]).write_text(json.dumps(got, indent=1, sort_keys=True), encoding="utf-8")
    changed = sorted(k for k in set(got) | set(want) if got.get(k) != want.get(k))
    assert not changed, f"movie behaviour changed: {changed}"
