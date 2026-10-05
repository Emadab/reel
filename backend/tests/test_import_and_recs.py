import io
import zipfile

from app import importers
from conftest import FILMS, drain, log

DIARY = """Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date
2024-01-02,Arrival,2016,https://boxd.it/a,4.5,,,2024-01-01
2024-02-02,Stalker,1979,https://boxd.it/b,5,Yes,,2024-02-01
2024-03-02,Unknown Film Nobody Made,2001,https://boxd.it/c,3,,,2024-03-01
"""
RATINGS = """Date,Name,Year,Letterboxd URI,Rating
2024-01-02,Arrival,2016,https://boxd.it/a,4.5
2019-05-05,Solaris,1973,https://boxd.it/d,4
"""
IMDB = """Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors
tt843,9,2021-04-04,In the Mood for Love,,,Movie,8.1,98,2000,,,,
tt999,7,2021-04-04,Some Series,,,TV Series,8.1,98,2000,,,,
"""


def test_parse_letterboxd_zip_and_imdb():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("diary.csv", DIARY)
        z.writestr("ratings.csv", RATINGS)
    rows = importers.parse_letterboxd({"letterboxd.zip": buf.getvalue()})
    assert [(r["title"], r["date_precision"]) for r in rows] == [
        ("Arrival", "day"), ("Stalker", "day"), ("Unknown Film Nobody Made", "day"), ("Solaris", "year")]
    assert rows[1]["is_rewatch"] and rows[3]["watched_on"] == "2019-01-01"
    assert [r["rating"] for r in rows] == [9, 10, 6, 8]  # Letterboxd stars doubled to 0–10
    imdb = importers.parse_imdb(IMDB.encode())
    assert len(imdb) == 1 and imdb[0]["rating"] == 9 and imdb[0]["imdb_id"] == "tt843"


def test_letterboxd_import_review_and_commit_is_idempotent(client):
    files = [("files", ("diary.csv", DIARY, "text/csv")), ("files", ("ratings.csv", RATINGS, "text/csv"))]
    job_id = client.post("/api/import/letterboxd", files=files).json()["job_id"]
    drain(client)
    job = client.get(f"/api/import/{job_id}").json()
    status = {r["raw"]["title"]: r["status"] for r in job["rows"]}
    assert status == {"Arrival": "matched", "Stalker": "matched", "Unknown Film Nobody Made": "unmatched", "Solaris": "matched"}
    assert job["summary"]["included"] == 3

    unmatched = next(i for i, r in enumerate(job["rows"]) if r["status"] == "unmatched")
    client.patch(f"/api/import/{job_id}/rows/{unmatched}", json={"tmdb_id": 843})
    assert client.post(f"/api/import/{job_id}/commit").json() == {"created": 4, "skipped": 0}

    again = client.post("/api/import/letterboxd", files=files).json()["job_id"]
    drain(client)
    assert client.post(f"/api/import/{again}/commit").json()["created"] == 0  # no duplicates
    lib = client.get("/api/library").json()
    assert lib["counts"]["watched"] == 4
    stalker = client.get("/api/movies/1398").json()
    assert stalker["watches"][0]["is_rewatch"] is True


def test_imdb_import(client):
    job_id = client.post("/api/import/imdb", files=[("files", ("ratings.csv", IMDB, "text/csv"))]).json()["job_id"]
    drain(client)
    assert client.post(f"/api/import/{job_id}/commit").json()["created"] == 1
    w = client.get("/api/movies/843").json()["watches"][0]
    assert w["rating"] == 9 and w["date_precision"] == "year"


def _history(client):
    """25 rated films: high ratings for the Villeneuve/Tarkovsky sci-fi side, low for the comedy fillers."""
    log(client, 329865, "2026-08-23", 10)
    log(client, 335984, "2026-07-01", 10)
    log(client, 1398, "2026-06-01", 9)
    log(client, 843, "2026-05-01", 8)
    for i in range(20):
        log(client, 900000 + i, f"2025-{(i % 12) + 1:02d}-10", 4 if i % 2 == 0 else 7)
    drain(client)


def test_recommender_slate_explains_and_learns(client):
    _history(client)
    client.post("/api/recommendations/recompute")
    drain(client)
    recs = client.get("/api/recommendations").json()
    assert recs["onboarding"] is False and recs["model"]["version"] in ("v1", "v2")
    slate = [recs["top"]] + recs["items"]
    ids = [r["tmdb_id"] for r in slate]
    assert set(ids) <= {593, 146233, 11104, 25623}  # only candidates, never something seen
    assert 329865 not in ids
    solaris = next(r for r in slate if r["tmdb_id"] == 593)
    assert solaris["because"] and solaris["because"][0]["title"] in ("Stalker", "Arrival", "Blade Runner 2049")
    assert any("Tarkovsky" not in r and "memory" in r or r.startswith("same director") for r in solaris["reasons"])
    assert 0 <= solaris["score"] <= 1

    # deterministic: recomputing gives the same order
    client.post("/api/recommendations/recompute")
    drain(client)
    again = client.get("/api/recommendations").json()
    assert [r["tmdb_id"] for r in [again["top"]] + again["items"]] == ids

    # not interested removes the film from the next slate
    client.post("/api/feedback", json={"tmdb_id": 593, "signal": "not_interested"})
    client.post("/api/recommendations/recompute")
    drain(client)
    after = client.get("/api/recommendations").json()
    assert 593 not in [r["tmdb_id"] for r in [after["top"], *after["items"]] if r]

    tm = client.get("/api/tastemap").json()
    kinds = {p["kind"] for p in tm["points"]}
    assert "watched" in kinds and tm["film_count"] >= len(FILMS) - 2
    assert all(0 <= p["x"] <= 1 and 0 <= p["y"] <= 1 for p in tm["points"])
    ex = client.get(f"/api/tastemap/explain/{after['top']['tmdb_id']}").json()
    assert ex["nearest"] and ex["note"]
    assert client.get("/api/movies/329865").json()["neighbors"]


def test_onboarding_until_ten_ratings(client):
    log(client, 329865, "2026-08-23", 5)
    assert client.get("/api/recommendations").json()["onboarding"] is True
    films = client.get("/api/onboarding").json()
    assert films and 329865 not in [f["tmdb_id"] for f in films]
    client.post(f"/api/onboarding/skip/{films[0]['tmdb_id']}")
    assert films[0]["tmdb_id"] not in [f["tmdb_id"] for f in client.get("/api/onboarding").json()]


def test_backup_restore_roundtrip(client):
    log(client, 329865, "2026-08-23", 5)
    z = client.get("/api/system/backup")
    assert z.status_code == 200 and z.content[:2] == b"PK"
    log(client, 843, "2026-08-24", 4)
    assert client.post("/api/system/restore", files={"file": ("b.zip", z.content, "application/zip")}).json() == {"ok": True}
    assert client.get("/api/library").json()["counts"]["watched"] == 1
