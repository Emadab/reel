from datetime import date

from sqlmodel import Session

from app import config, db, media
from app.models import Movie
from app.cards import normalize
from conftest import drain, log


def test_normalize_by_precision():
    assert normalize(date(2019, 7, 20), "year") == date(2019, 1, 1)
    assert normalize(date(2020, 3, 17), "month") == date(2020, 3, 1)
    assert normalize(date(2020, 3, 17), "day") == date(2020, 3, 17)


def test_palette_order_and_contrast():
    pal = media.choose_palette([(208, 65, 26), (64, 181, 189), (27, 23, 27), (202, 210, 184), (90, 90, 90)])
    assert len(pal) == 5 and all(c.startswith("#") for c in pal)
    glow_l = media.to_oklch(media.hex_to_rgb(pal[0]))[0]
    assert 0.55 <= glow_l <= 0.85
    assert media.to_oklch(media.hex_to_rgb(pal[2]))[0] <= 0.26  # dark
    assert media.to_oklch(media.hex_to_rgb(pal[3]))[0] >= 0.84  # light


def test_search_then_log_caches_everything(client):
    r = client.get("/api/search", params={"q": "arrival"}).json()
    assert r["results"][0]["tmdb_id"] == 329865
    assert r["results"][0]["poster_sm"].startswith("/api/img/w185/")

    client.post("/api/watchlist/329865")
    assert client.get("/api/library", params={"tab": "watchlist"}).json()["counts"]["watchlist"] == 1

    log(client, 329865, "2026-08-23", 4.5, location="Home")
    d = client.get("/api/movies/329865").json()
    assert d["director"] == "Denis Villeneuve" and d["trailer_key"] == "yt329865"
    assert d["crew_highlights"]["cinematography"] == ["Roger Deakins"]
    assert len(d["palette"]) == 5 and d["poster"] == "/media/poster/329865.jpg"
    assert client.get(d["poster"]).status_code == 200
    assert d["on_watchlist"] is False  # logging removed it from the watchlist
    assert d["my_rating"] == 4.5 and d["watch_count"] == 1


def test_rewatch_flags_follow_dates(client):
    later = log(client, 1398, "2026-01-12", 5)
    earlier = log(client, 1398, "2019-07-20", 4, precision="year")
    assert earlier["watched_on"] == "2019-01-01" and not earlier["is_rewatch"]
    watches = client.get("/api/movies/1398").json()["watches"]
    assert [w["is_rewatch"] for w in watches] == [True, False]  # newest first
    assert later["id"] == watches[0]["id"]


def test_library_tabs_filters_and_sort(client):
    log(client, 329865, "2026-08-23", 4.5)
    log(client, 843, "2026-09-06", 5)
    log(client, 843, "2020-03-01", 5, precision="month")
    log(client, 25623, "2025-05-01", 2.5)
    lib = client.get("/api/library").json()
    assert lib["counts"] == {"watched": 3, "watchlist": 0, "rewatches": 1}
    assert lib["totals"]["watches"] == 4
    assert lib["totals"]["hours"] == round((116 + 98 + 98 + 88) / 60)
    assert [i["title"] for i in lib["items"]] == ["In the Mood for Love", "Arrival", "House"]
    assert lib["last_watched"]["watch"]["watched_on"] == "2026-09-06"

    q = lambda **p: [i["title"] for i in client.get("/api/library", params=p).json()["items"]]  # noqa: E731
    assert q(genre="Romance") == ["In the Mood for Love"]
    assert q(decade=2010) == ["Arrival"]
    assert q(min_rating=4.5) == ["In the Mood for Love", "Arrival"]
    assert q(director="Nobuhiko Obayashi") == ["House"]
    assert q(sort="title") == ["Arrival", "House", "In the Mood for Love"]
    assert q(tab="rewatches") == ["In the Mood for Love"]
    facets = client.get("/api/library/facets").json()
    assert "Romance" in facets["genres"] and 2000 in facets["decades"]


def test_timeline_places_imprecise_dates(client):
    log(client, 329865, "2026-08-23", 4.5)
    log(client, 843, "2026-03-17", 5, precision="month")
    log(client, 1398, "2026-05-05", 5, precision="year")
    t = client.get("/api/timeline", params={"year": 2026}).json()
    assert [f["title"] for f in t["months"][7]["films"]] == ["Arrival"]
    assert [f["title"] for f in t["months"][2]["approx"]] == ["In the Mood for Love"]
    assert [f["title"] for f in t["year_only"]] == ["Stalker"]
    assert t["totals"] == {"watches": 3, "approx": 2, "hours": round((116 + 98 + 162) / 60, 1)}
    years = client.get("/api/timeline/years").json()
    assert years[-1]["year"] >= 2026 and next(y for y in years if y["year"] == 2026) == {"year": 2026, "total": 3, "approx": 2}


def test_stats_maths(client):
    log(client, 329865, "2026-08-23", 4.5)
    log(client, 335984, "2026-08-23", 5)
    log(client, 843, "2026-03-01", 3.5, precision="month")
    log(client, 843, "2025-01-10", 3)
    s = client.get("/api/stats", params={"range": "2026"}).json()
    k = s["kpis"]
    assert k["films"] == 3 and k["watches"] == 3
    assert k["hours"] == round((116 + 164 + 98) / 60, 1)
    assert k["viewing_days"] == 1  # two films on one day; month precision doesn't count
    assert {b["bin"]: b["count"] for b in s["ratings"]}[5.0] == 1
    assert sum(b["count"] for b in s["ratings"]) == 3
    assert k["avg_rating"] == round((4.5 + 5 + 3.5) / 3, 1)
    assert s["directors"][0] == {"name": "Denis Villeneuve", "count": 2}
    all_time = client.get("/api/stats").json()
    assert all_time["kpis"]["rewatched"] == 1 and all_time["kpis"]["first_year"] == 2025


def test_errors_are_friendly(client):
    assert client.get("/api/movies/1").status_code == 404
    assert client.post("/api/watches", json={"tmdb_id": 329865, "watched_on": "2026-01-01", "rating": 10.5}).status_code == 422
    assert client.get("/api/stats", params={"range": "nope"}).status_code == 422


def test_delete_and_edit_watch(client):
    w = log(client, 329865, "2026-08-23", 4.5)
    assert client.patch(f"/api/watches/{w['id']}", json={"rating": 3, "date_precision": "month"}).json()["watched_on"] == "2026-08-01"
    assert client.delete(f"/api/watches/{w['id']}").status_code == 204
    assert client.get("/api/library").json()["counts"]["watched"] == 0
    drain(client)


def test_omdb_key_is_checked_then_fills_library_scores(client, monkeypatch, tmp_path):
    monkeypatch.setattr(config, "ENV_FILE", tmp_path / ".env")
    monkeypatch.setenv("OMDB_KEY", "")
    log(client, 329865, "2026-08-23", 9)
    try:
        assert client.put("/api/settings", json={"omdb_key": "bad"}).status_code == 422
        assert client.put("/api/settings", json={"omdb_key": "good"}).status_code == 200
        drain(client)
        with Session(db.engine) as s:  # filled by the background job, before any detail page opens
            assert s.get(Movie, 329865).omdb == {"imdb": "7.9", "rt": "94%", "metacritic": "81"}
    finally:
        config.settings.omdb_key = ""
