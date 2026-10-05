"""Phase 8: per-medium timeline and stats, the all-media summary, recommendation signals and slate, the taste
map, and Goodreads / StoryGraph / IMDb TV imports (review, commit, no duplicates)."""
from datetime import date

from sqlmodel import Session

from app import db, tmdb
from app.models_media import Item, LibraryEntry, Run
from app.providers import openlibrary
from app.providers.base import SearchHit
from app.recommender import media as recs
from conftest import drain, log
from test_media import SHOW, media  # noqa: F401  (fixture)

GOODREADS = '''Book Id,Title,Author,ISBN,ISBN13,My Rating,Exclusive Shelf,Date Read,Date Added,Read Count,Owned Copies
1,Piranesi,Susanna Clarke,"=""""","=""9781635575637""",5,read,2024/03/02,2024/01/01,1,0
2,The Hobbit,J.R.R. Tolkien,"=""""","=""""",0,to-read,,2024/02/01,0,0
'''
STORYGRAPH = """Title,Authors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Dates Read,Read Count,Star Rating,Owned?
Dune,Frank Herbert,9780441172719,paperback,did-not-finish,2024/01/05,,,0,,No
Piranesi,Susanna Clarke,9781635575637,ebook,read,2024/01/01,2024/03/02,,1,4.5,Yes
"""
IMDB = """Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors
tt0944947,9,2024-05-01,Severance,,,TV Series,8.7,55,2022,,,,
tt843,8,2021-04-04,In the Mood for Love,,,Movie,8.1,98,2000,,,,
"""


def test_signals_follow_tracking_states():
    book = Item(kind="book", title="X", details={"pages": 100})
    finished = Run(item_id=1, status="finished")
    early = Run(item_id=1, status="did_not_finish", progress={"unit": "page", "current": 10, "total": 100})
    late = Run(item_id=1, status="did_not_finish", progress={"unit": "page", "current": 90, "total": 100})
    assert recs.signal("book", book, finished, None) == 1.0
    assert recs.signal("book", book, early, None) == -1.0  # DNF before 25%: strong negative
    assert recs.signal("book", book, late, None) == -0.3  # after 75%: mild
    assert recs.signal("book", book, Run(item_id=1, status="paused"), None) == 0.0
    assert recs.signal("book", book, Run(item_id=1, status="finished", rating=10), None) == 1.0
    assert recs.signal("book", book, None, LibraryEntry(item_id=1, shelf="not_interested")) == -0.8


def test_timeline_stats_and_all_media(media):  # noqa: F811
    log(media, 329865, "2026-08-23", 9)
    b = media.post("/api/media/book/items", json={"ext_id": "OL1W", "status": "reading"}).json()
    run_id = media.get(f"/api/media/items/{b['id']}").json()["runs"][0]["id"]
    media.post(f"/api/media/runs/{run_id}/progress", json={"unit": "page", "current": 100})
    media.post(f"/api/media/runs/{run_id}/progress", json={"current": 272})
    media.patch(f"/api/media/runs/{run_id}", json={"rating": 9})
    d = media.post("/api/media/book/items", json={"ext_id": "OL2W", "status": "reading"}).json()
    media.post(f"/api/media/items/{d['id']}/status", json={"status": "did_not_finish"})
    media.post("/api/media/items/" + str(b["id"]) + "/runs", json={"status": "finished", "finished_on": "2019-06-01", "date_precision": "year"})

    year = date.today().year
    tl = media.get("/api/media/book/timeline", params={"year": year}).json()
    assert tl["totals"]["finished"] == 1 and tl["totals"]["pages"] == 272
    assert sum(len(m["items"]) for m in tl["months"]) == 1
    old = media.get("/api/media/book/timeline", params={"year": 2019}).json()
    assert len(old["year_only"]) == 1  # "sometime in 2019" never shows a fake day
    assert [y["year"] for y in media.get("/api/media/book/timeline/years").json()][0] == 2019

    st = media.get("/api/media/book/stats").json()
    k = st["kpis"]
    assert k["finished"] == 2 and k["dropped"] == 1 and k["drop_rate"] == 0.33 and k["avg_rating"] == 9
    assert st["genres"][0]["name"] == "Fantasy" and st["people"][0]["rows"][0]["name"] == "Susanna Clarke"
    allm = media.get("/api/media/all/stats").json()
    rows = {r["kind"]: r for r in allm["rows"]}
    assert rows["movie"]["finished"] == 1 and rows["book"]["pages"] == 272 and rows["book"]["drop_rate"] == 0.33
    media.put("/api/settings", json={"flags": {"media.shows": False, "media.books": False, "media.games": False}})
    assert media.get("/api/media/all/stats").status_code == 404


def test_show_recommendations_and_tastemap(media, monkeypatch):  # noqa: F811
    async def fake_get(path, **kw):
        assert path == "/genre/tv/list"
        return {"genres": [{"id": 18, "name": "Drama"}, {"id": 9648, "name": "Mystery"}]}

    async def fake_lists(path, **kw):
        return [{"id": 100 + i, "name": f"Mystery Drama {i}", "overview": "office memory mystery drama", "genre_ids": [18, 9648],
                 "first_air_date": "2020-01-01", "poster_path": None} for i in range(3)]

    monkeypatch.setattr(tmdb, "get", fake_get)
    monkeypatch.setattr(tmdb, "lists", fake_lists)
    item_id = media.post("/api/media/show/items", json={"ext_id": "95396"}).json()["id"]
    media.post(f"/api/media/items/{item_id}/episodes", json={"season": 1})
    run_id = media.get(f"/api/media/items/{item_id}").json()["runs"][0]["id"]
    media.patch(f"/api/media/runs/{run_id}", json={"rating": 9.5})
    media.post("/api/media/show/recommendations/recompute")
    drain(media)
    r = media.get("/api/media/show/recommendations").json()
    assert len(r["items"]) == 3 and r["model"] == "cosine" and r["learned_from"] == 1
    assert r["items"][0]["because"][0]["id"] == item_id and not r["items"][0]["in_library"]
    pts = media.get("/api/media/show/tastemap").json()["points"]
    assert {p["kind"] for p in pts} == {"mine", "suggested"} and all(0 <= p["x"] <= 1 for p in pts)
    # not interested removes it from the slate
    media.patch(f"/api/media/items/{r['items'][0]['id']}", json={"shelf": "not_interested"})
    assert r["items"][0]["id"] not in [x["id"] for x in media.get("/api/media/show/recommendations").json()["items"]]


def _book_matchers(monkeypatch):
    async def by_isbn(isbn):
        return {"9781635575637": "OL1W", "9780441172719": "OL9W"}.get(isbn)

    async def search(q, kind="book"):
        return [SearchHit("book", "openlibrary", "OL7W", "The Hobbit", 1937, "J.R.R. Tolkien")]

    monkeypatch.setattr(openlibrary, "by_isbn", by_isbn)
    monkeypatch.setattr(openlibrary, "search", search)


def test_goodreads_import_review_commit_no_duplicates(media, monkeypatch):  # noqa: F811
    _book_matchers(monkeypatch)
    job = media.post("/api/media/import/goodreads", files=[("files", ("goodreads.csv", GOODREADS, "text/csv"))]).json()["job_id"]
    drain(media)
    j = media.get(f"/api/media/import/{job}").json()
    assert j["summary"] == {"matched": 2, "ambiguous": 0, "unmatched": 0, "included": 2}
    assert j["rows"][0]["raw"]["rating"] == 10 and j["rows"][0]["raw"]["date"] == "2024-03-02"
    assert media.post(f"/api/media/import/{job}/commit").json() == {"created": 2, "skipped": 0}
    lib = media.get("/api/media/book/library").json()
    assert lib["counts"]["finished"] == 1 and lib["counts"]["wishlist"] == 1
    again = media.post("/api/media/import/goodreads", files=[("files", ("goodreads.csv", GOODREADS, "text/csv"))]).json()["job_id"]
    drain(media)
    assert media.post(f"/api/media/import/{again}/commit").json()["created"] == 0
    with Session(db.engine) as s:
        run = s.get(Run, 1)
        assert run.finished_on == date(2024, 3, 2) and run.rating == 10


def test_storygraph_dnf_and_imdb_tv(media, monkeypatch):  # noqa: F811
    _book_matchers(monkeypatch)
    job = media.post("/api/media/import/storygraph", files=[("files", ("sg.csv", STORYGRAPH, "text/csv"))]).json()["job_id"]
    drain(media)
    assert media.post(f"/api/media/import/{job}/commit").json()["created"] == 2
    lib = media.get("/api/media/book/library").json()
    assert lib["counts"]["did_not_finish"] == 1 and lib["counts"]["finished"] == 1
    dune = next(i for i in lib["items"] if i["status"] == "did_not_finish")
    assert media.get(f"/api/media/items/{dune['id']}").json()["runs"][0]["started_on"] is None  # no invented dates

    SHOW["status"] = "ended"
    SHOW["future_ep"] = False

    async def find(path, **kw):
        assert path == "/find/tt0944947"
        return {"tv_results": [{"id": 95396, "name": "Severance", "first_air_date": "2022-02-18"}]}

    monkeypatch.setattr(tmdb, "get", find)
    job = media.post("/api/media/import/imdb_tv", files=[("files", ("ratings.csv", IMDB, "text/csv"))]).json()["job_id"]
    drain(media)
    rows = media.get(f"/api/media/import/{job}").json()["rows"]
    assert len(rows) == 1  # the film row stays with the movie importer
    assert media.post(f"/api/media/import/{job}/commit").json()["created"] == 1
    show = media.get("/api/media/show/library").json()["items"][0]
    assert show["status"] == "completed" and show["my_rating"] == 9 and show["progress"]["watched"] == 2
