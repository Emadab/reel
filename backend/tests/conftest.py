"""Test setup: a throwaway data dir, a fake TMDB (respx) and a deterministic fake embedder."""
import hashlib
import io
import os
import re
import tempfile

os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="reel-test-")
os.environ["TMDB_TOKEN"] = "test-token"
os.environ["OMDB_KEY"] = ""

import numpy as np
import pytest
import respx
from fastapi.testclient import TestClient
from httpx import Response
from PIL import Image

from app import db, jobs
from app.models import SQLModel
from app.recommender import features

# ---- a small fake TMDB catalogue: id -> (title, year, genres, keywords, director id/name, runtime) ----
FILMS: dict[int, tuple] = {
    329865: ("Arrival", 2016, ["Science Fiction", "Drama"], ["alien", "language", "time"], (137427, "Denis Villeneuve"), 116),
    335984: ("Blade Runner 2049", 2017, ["Science Fiction", "Drama"], ["replicant", "dystopia", "memory"], (137427, "Denis Villeneuve"), 164),
    1398: ("Stalker", 1979, ["Science Fiction", "Drama"], ["zone", "desire", "memory"], (8452, "Andrei Tarkovsky"), 162),
    593: ("Solaris", 1972, ["Science Fiction", "Drama"], ["space station", "memory", "grief"], (8452, "Andrei Tarkovsky"), 167),
    843: ("In the Mood for Love", 2000, ["Romance", "Drama"], ["longing", "hong kong", "affair"], (12453, "Wong Kar-wai"), 98),
    11104: ("Chungking Express", 1994, ["Romance", "Comedy"], ["longing", "hong kong", "police"], (12453, "Wong Kar-wai"), 102),
    146233: ("Prisoners", 2013, ["Thriller", "Crime"], ["kidnapping", "detective"], (137427, "Denis Villeneuve"), 153),
    25623: ("House", 1977, ["Horror", "Comedy"], ["haunted house", "cat"], (99999, "Nobuhiko Obayashi"), 88),
}
for i in range(20):  # filler films so the recommender has enough history
    FILMS[900000 + i] = (f"Filler {i}", 1990 + i, ["Drama"] if i % 2 else ["Comedy"], [f"kw{i % 5}", "everyday"], (500 + i % 4, f"Director {i % 4}"), 90 + i)

RECS = {329865: [593, 146233, 11104], 335984: [593, 146233], 1398: [593], 843: [11104]}


def details(tmdb_id: int) -> dict:
    title, year, genres, kws, (did, dname), runtime = FILMS[tmdb_id]
    return {
        "id": tmdb_id, "title": title, "original_title": title, "release_date": f"{year}-06-01", "runtime": runtime,
        "overview": f"{title} overview.", "tagline": "", "original_language": "en",
        "genres": [{"id": abs(hash(g)) % 1000, "name": g} for g in genres],
        "poster_path": f"/p{tmdb_id}.jpg", "backdrop_path": f"/b{tmdb_id}.jpg",
        "vote_average": 7.8 if tmdb_id == 25623 else 7.0, "vote_count": 900, "popularity": 20.0,
        "external_ids": {"imdb_id": f"tt{tmdb_id}"},
        "credits": {"crew": [{"id": did, "name": dname, "job": "Director"}, {"id": 1, "name": "Roger Deakins", "job": "Director of Photography"}],
                    "cast": [{"id": tmdb_id * 10 + k, "name": f"Actor {tmdb_id}-{k}", "character": "X", "order": k, "profile_path": None} for k in range(3)]},
        "keywords": {"keywords": [{"id": abs(hash(k)) % 100000, "name": k} for k in kws]},
        "videos": {"results": [{"site": "YouTube", "type": "Trailer", "official": True, "key": f"yt{tmdb_id}", "published_at": "2020"}]},
    }


def summary(tmdb_id: int) -> dict:
    title, year, *_ = FILMS[tmdb_id]
    return {"id": tmdb_id, "title": title, "release_date": f"{year}-06-01", "poster_path": f"/p{tmdb_id}.jpg", "vote_count": 1000}


def png(color=(200, 80, 40)) -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGB", (40, 60), color)
    for x in range(20):
        for y in range(30):
            img.putpixel((x, y), (30, 140, 150))
    img.save(buf, "PNG")
    return buf.getvalue()


def tmdb_router() -> respx.MockRouter:
    r = respx.mock(assert_all_called=False)
    api = "https://api.themoviedb.org/3"

    def search(request):
        q = request.url.params["query"].lower()
        return Response(200, json={"results": [summary(i) for i, f in FILMS.items() if q in f[0].lower()]})

    def movie(request):
        m = re.match(r".*/movie/(\d+)$", request.url.path)
        i = int(m.group(1))
        return Response(200, json=details(i)) if i in FILMS else Response(404)

    def recs(request):
        i = int(re.match(r".*/movie/(\d+)/", request.url.path).group(1))
        return Response(200, json={"results": [summary(x) for x in RECS.get(i, [])]})

    r.get(f"{api}/search/movie").mock(side_effect=search)
    r.get(host="api.themoviedb.org", path__regex=r"^/3/movie/\d+$").mock(side_effect=movie)
    r.get(host="api.themoviedb.org", path__regex=r"^/3/movie/\d+/credits$").mock(side_effect=lambda req: Response(200, json=details(int(req.url.path.split("/")[-2]))["credits"]))
    r.get(host="api.themoviedb.org", path__regex=r"^/3/movie/\d+/(recommendations|similar)$").mock(side_effect=recs)
    r.get(f"{api}/discover/movie").mock(return_value=Response(200, json={"results": [summary(25623)]}))
    r.get(host="api.themoviedb.org", path__regex=r"^/3/movie/(top_rated|popular)$").mock(return_value=Response(200, json={"results": [summary(i) for i in list(FILMS)[:8]]}))
    r.get(host="api.themoviedb.org", path__regex=r"^/3/find/tt\d+$").mock(side_effect=lambda req: Response(200, json={"movie_results": [summary(int(req.url.path.split("tt")[-1]))]}))
    r.get(f"{api}/configuration").mock(return_value=Response(200, json={}))
    r.get(url__regex=r"https://image\.tmdb\.org/.*").mock(return_value=Response(200, content=png()))
    return r


def fake_embed(texts: list[str]) -> np.ndarray:
    """Bag of hashed words: films that share keywords/genres are similar, deterministically."""
    out = np.zeros((len(texts), features.DIM), dtype=np.float32)
    for row, t in enumerate(texts):
        for word in re.findall(r"[a-z]+", t.lower()):
            out[row, int(hashlib.md5(word.encode()).hexdigest(), 16) % features.DIM] += 1
    out /= np.linalg.norm(out, axis=1, keepdims=True) + 1e-9
    return out


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(features, "embed_texts", fake_embed)
    db.engine.dispose()
    SQLModel.metadata.drop_all(db.engine)
    with tmdb_router(), TestClient(app_module().app) as c:
        yield c
        c.portal.call(jobs.drain)  # let background jobs finish before the next test resets the database
    jobs.status.clear()
    db.engine.dispose()


def app_module():
    from app import main

    return main


def drain(c: TestClient) -> None:
    """Run queued background jobs to completion."""
    c.portal.call(jobs.drain)  # type: ignore[union-attr]


def log(c: TestClient, tmdb_id: int, when: str, rating: float | None = None, precision: str = "day", **kw):
    r = c.post("/api/watches", json={"tmdb_id": tmdb_id, "watched_on": when, "date_precision": precision, "rating": rating, **kw})
    assert r.status_code == 200, r.text
    return r.json()
