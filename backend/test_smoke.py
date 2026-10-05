"""Smoke test with TMDB mocked. Run: uv run python test_smoke.py"""
import io
import os
import tempfile

os.environ["REEL_DATA"] = tempfile.mkdtemp()

import httpx
from fastapi.testclient import TestClient
from PIL import Image

from app import tmdb
from app.main import app

MOVIE = {
    "id": 329865, "title": "Arrival", "release_date": "2016-11-10", "runtime": 116, "overview": "Aliens.",
    "tagline": "Why are they here?", "genres": [{"name": "Science Fiction"}], "original_language": "en",
    "poster_path": "/p.jpg", "backdrop_path": "/b.jpg", "vote_average": 7.6,
    "external_ids": {"imdb_id": "tt2543164"},
    "credits": {"crew": [{"name": "Denis Villeneuve", "job": "Director"}],
                "cast": [{"name": "Amy Adams", "character": "Louise", "profile_path": "/a.jpg"}]},
    "keywords": {"keywords": [{"name": "linguistics"}]},
    "videos": {"results": [{"site": "YouTube", "type": "Trailer", "key": "tFMo3UJ4B4g"}]},
}


def api(req: httpx.Request):
    if req.url.path == "/3/search/movie":
        return httpx.Response(200, json={"results": [MOVIE]})
    if req.url.path == "/3/movie/329865":
        return httpx.Response(200, json=MOVIE)
    return httpx.Response(404)


def images(_):
    buf = io.BytesIO()
    Image.new("RGB", (40, 40), (200, 30, 30)).save(buf, "PNG")
    return httpx.Response(200, content=buf.getvalue())


tmdb.TOKEN = "test"
tmdb.api = httpx.AsyncClient(base_url="https://api.themoviedb.org/3", transport=httpx.MockTransport(api))
tmdb.img = httpx.AsyncClient(base_url=tmdb.CDN, transport=httpx.MockTransport(images))

with TestClient(app) as c:
    assert c.get("/search", params={"q": "arrival"}).json()[0]["year"] == 2016
    assert c.get("/movies/1").status_code == 404

    assert c.post("/watchlist/329865").status_code == 200
    assert len(c.get("/watchlist").json()) == 1

    # logged out of order: the 2019 backfill is the first viewing
    w2 = c.post("/watches", json={"tmdb_id": 329865, "watched_on": "2024-05-03", "rating": 4.5}).json()
    w1 = c.post("/watches", json={"tmdb_id": 329865, "watched_on": "2019-07-20", "date_precision": "year"}).json()
    assert w1["watched_on"] == "2019-01-01" and not w1["is_rewatch"]
    assert c.get("/watchlist").json() == []  # watching removes it from the watchlist
    assert c.post("/watches", json={"tmdb_id": 329865, "watched_on": "2024-01-01", "rating": 4.3}).status_code == 422

    d = c.get("/movies/329865").json()
    assert d["director"] == "Denis Villeneuve" and d["trailer_key"] == "tFMo3UJ4B4g"
    assert d["palette"] and d["palette"][0].startswith("#")
    assert [w["is_rewatch"] for w in d["watches"]] == [True, False]
    assert c.get(f"/images/{d['poster_path']}").status_code == 200

    lib = c.get("/movies").json()
    assert lib[0]["watch_count"] == 2 and lib[0]["last_watched"] == "2024-05-03"

    c.delete(f"/watches/{w1['id']}")
    assert c.get("/movies/329865").json()["watches"][0]["is_rewatch"] is False

print("ok")
