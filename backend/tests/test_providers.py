"""Provider layer: the shared HTTP client (limiter, cache, ETag, retries, coalescing, offline) and each
provider's normalisation, against recorded-style fixtures (respx)."""
import asyncio
import time
from datetime import UTC, datetime

import pytest
import respx
from httpx import Response
from sqlmodel import SQLModel

from app import db, net
from app.config import settings
from app.providers import googlebooks, hardcover, openlibrary, rawg, tvmaze
from app.providers.http import Client
from app.providers.tmdb_tv import provider as tmdb_tv


@pytest.fixture(autouse=True)
def fresh_db(monkeypatch):
    db.engine.dispose()
    SQLModel.metadata.drop_all(db.engine)
    db.migrate()
    net.mark_online()
    monkeypatch.setattr(settings, "rawg_key", "rk")
    monkeypatch.setattr(settings, "hardcover_token", "ht")
    yield
    net.mark_online()
    db.engine.dispose()


def run(coro):
    return asyncio.run(coro)


@respx.mock
def test_limiter_spaces_requests():
    respx.get("https://x.test/a").mock(return_value=Response(200, json={}))
    c = Client("X", "https://x.test", rate=20)

    async def go():
        for i in range(6):
            await c.get("/a", {"i": i})

    t = time.monotonic()
    run(go())
    assert time.monotonic() - t >= 0.24  # 6 requests at 20/s: 5 gaps of 50 ms


@respx.mock
def test_cache_ttl_and_etag_revalidation():
    fresh = respx.get("https://x.test/fresh").mock(return_value=Response(200, json={"v": 1}))
    c = Client("X", "https://x.test", rate=100)
    assert run(c.get("/fresh")) == {"v": 1}
    assert run(c.get("/fresh")) == {"v": 1} and fresh.call_count == 1  # served from SQLite

    stale = respx.get("https://x.test/stale").mock(side_effect=[Response(200, json={"v": 2}, headers={"etag": '"e1"'}), Response(304)])
    c0 = Client("X", "https://x.test", rate=100, ttl=0)
    assert run(c0.get("/stale")) == {"v": 2}
    assert run(c0.get("/stale")) == {"v": 2} and stale.call_count == 2
    assert stale.calls[-1].request.headers["if-none-match"] == '"e1"'


@respx.mock
def test_retries_429_then_succeeds_and_404_is_none():
    route = respx.get("https://x.test/r").mock(side_effect=[Response(429, headers={"retry-after": "0"}), Response(503), Response(200, json=[1])])
    respx.get("https://x.test/missing").mock(return_value=Response(404))
    c = Client("X", "https://x.test", rate=100)
    assert run(c.get("/r")) == [1] and route.call_count == 3
    assert run(c.get("/missing")) is None


@respx.mock
def test_identical_inflight_requests_coalesce():
    async def slow(_):
        await asyncio.sleep(0.05)
        return Response(200, json={"ok": True})

    route = respx.get("https://x.test/s").mock(side_effect=slow)
    c = Client("X", "https://x.test", rate=100)

    async def go():
        return await asyncio.gather(*(c.get("/s") for _ in range(5)))

    assert run(go()) == [{"ok": True}] * 5 and route.call_count == 1


@respx.mock
def test_offline_serves_stale_cache():
    respx.get("https://x.test/o").mock(return_value=Response(200, json={"v": 1}))
    c = Client("X", "https://x.test", rate=100, ttl=0)
    run(c.get("/o"))
    net.mark_offline()
    assert run(c.get("/o")) == {"v": 1}


# ---- providers ----

@respx.mock
def test_tmdb_tv_fetch(monkeypatch):
    monkeypatch.setattr(settings, "tmdb_token", "t")
    api = "https://api.themoviedb.org/3"
    respx.get(f"{api}/tv/1399").mock(return_value=Response(200, json={
        "id": 1399, "name": "Game of Thrones", "first_air_date": "2011-04-17", "status": "Ended", "overview": "Dragons.",
        "genres": [{"id": 1, "name": "Drama"}], "poster_path": "/p.jpg", "backdrop_path": "/b.jpg", "networks": [{"name": "HBO"}],
        "created_by": [{"id": 9, "name": "David Benioff"}],
        "seasons": [{"season_number": 0, "name": "Specials", "episode_count": 1}, {"season_number": 1, "name": "Season 1", "air_date": "2011-04-17", "episode_count": 2}],
        "external_ids": {"imdb_id": "tt0944947", "tvdb_id": 121361},
        "aggregate_credits": {"cast": [{"id": 5, "name": "Emilia Clarke", "roles": [{"character": "Daenerys"}]}]},
        "keywords": {"results": [{"name": "dragon"}]}, "recommendations": {"results": [{"id": 2, "name": "Rome", "first_air_date": "2005-08-28"}]},
        "content_ratings": {"results": [{"iso_3166_1": "US", "rating": "TV-MA"}]}}))
    respx.get(f"{api}/tv/1399/season/0").mock(return_value=Response(200, json={"episodes": [{"id": 70, "season_number": 0, "episode_number": 1, "name": "Making of"}]}))
    respx.get(f"{api}/tv/1399/season/1").mock(return_value=Response(200, json={"episodes": [
        {"id": 71, "season_number": 1, "episode_number": 1, "name": "Winter Is Coming", "air_date": "2011-04-17", "runtime": 62},
        {"id": 72, "season_number": 1, "episode_number": 2, "name": "The Kingsroad", "air_date": "2011-04-24"}]}))
    d = run(tmdb_tv.fetch("1399"))
    assert d.status == "ended" and d.external_ids == {"tmdb_tv": "1399", "imdb": "tt0944947", "tvdb": "121361"}
    assert [(e.season, e.number, e.is_special) for e in d.episodes] == [(0, 1, True), (1, 1, False), (1, 2, False)]
    assert d.episodes[1].airstamp_utc == datetime(2011, 4, 17, tzinfo=UTC)
    assert d.details["networks"] == ["HBO"] and d.details["certification"] == "TV-MA"
    assert d.people[0].role == "creator" and d.people[1].character == "Daenerys"
    assert d.recommendations[0].title == "Rome" and d.cover_url.endswith("/w500/p.jpg")


@respx.mock
def test_tvmaze_episodes_specials_and_updates():
    respx.get("https://api.tvmaze.com/shows/82/episodes").mock(return_value=Response(200, json=[
        {"id": 1, "season": 1, "number": 1, "type": "regular", "airstamp": "2011-04-18T01:00:00+00:00", "name": "Winter"},
        {"id": 2, "season": 1, "number": None, "type": "significant_special", "airstamp": None, "airdate": "2011-05-01"}]))
    respx.get("https://api.tvmaze.com/updates/shows").mock(return_value=Response(200, json={"82": 2_000_000_000, "83": 1}))
    eps = run(tvmaze.episodes("82"))
    assert (eps[0].season, eps[0].number, eps[0].airstamp_utc.hour) == (1, 1, 1)
    assert (eps[1].season, eps[1].is_special) == (0, True)
    assert run(tvmaze.changed_since(datetime(2030, 1, 1, tzinfo=UTC))) == {"82"}


@respx.mock
def test_openlibrary_search_and_fetch():
    ol = "https://openlibrary.org"
    respx.get(f"{ol}/search.json").mock(return_value=Response(200, json={"docs": [
        {"key": "/works/OL45804W", "title": "Fantastic Mr Fox", "author_name": ["Roald Dahl"], "first_publish_year": 1970, "cover_i": 6498519}]}))
    respx.get(f"{ol}/works/OL45804W.json").mock(return_value=Response(200, json={
        "title": "Fantastic Mr Fox", "description": {"value": "A fox."}, "subjects": ["Foxes", "Fiction"], "covers": [-1, 6498519],
        "authors": [{"author": {"key": "/authors/OL34184A"}}], "first_publish_date": "1970"}))
    respx.get(f"{ol}/authors/OL34184A.json").mock(return_value=Response(200, json={"name": "Roald Dahl"}))
    respx.get(f"{ol}/works/OL45804W/editions.json").mock(return_value=Response(200, json={"entries": [
        {"number_of_pages": 96, "isbn_13": ["9780140328721"]}, {"number_of_pages": 100}]}))
    hits = run(openlibrary.search("fox"))
    assert hits[0].ext_id == "OL45804W" and hits[0].subtitle == "Roald Dahl" and hits[0].cover_url.endswith("6498519-M.jpg")
    d = run(openlibrary.fetch("OL45804W"))
    assert d.overview == "A fox." and d.year == 1970 and d.details["pages"] == 98
    assert d.external_ids == {"openlibrary": "OL45804W", "isbn13": "9780140328721"} and d.people[0].name == "Roald Dahl"
    assert d.cover_url.endswith("6498519-L.jpg")


@respx.mock
def test_google_books_and_hardcover():
    respx.get("https://www.googleapis.com/books/v1/volumes").mock(return_value=Response(200, json={"items": [
        {"volumeInfo": {"description": "Desc", "pageCount": 320, "categories": ["Fiction"], "publishedDate": "2020-02-03"}}]}))
    g = run(googlebooks.lookup("9780000000001", "T", None))
    assert g["pages"] == 320 and g["published"].year == 2020
    route = respx.post("https://api.hardcover.app/v1/graphql").mock(return_value=Response(200, json={"data": {"editions": [{"book": {
        "id": 7, "title": "T", "release_date": "2020-02-03", "book_series": [{"position": 2, "series": {"id": 3, "name": "Saga"}}]}}]}}))
    h = run(hardcover.by_isbn("9780000000001"))
    assert h["series"] == [{"id": "3", "name": "Saga", "position": 2}]
    assert route.calls[0].request.headers["authorization"] == "Bearer ht"


@respx.mock
def test_hardcover_fills_book_when_google_is_down():
    from app import books
    ol = "https://openlibrary.org"
    respx.get(f"{ol}/works/OL1W.json").mock(return_value=Response(200, json={"title": "T"}))
    respx.get(f"{ol}/works/OL1W/editions.json").mock(return_value=Response(200, json={"entries": [{"isbn_13": ["9780000000002"]}]}))
    respx.get("https://www.googleapis.com/books/v1/volumes").mock(return_value=Response(403))
    respx.post("https://api.hardcover.app/v1/graphql").mock(return_value=Response(200, json={"data": {"editions": [{"book": {
        "id": 8, "title": "T", "release_date": "2001-05-06", "description": "<i>Hi</i> there", "pages": 210,
        "cached_tags": {"Genre": [{"tag": "Fantasy"}], "Mood": [{"tag": "Adventurous"}]}, "image": {"url": "https://assets.hardcover.app/c.jpg"}}}]}}))
    d = run(books.fetch_book("OL1W"))
    assert (d.overview, d.details["pages"], d.genres, d.tags) == ("Hi there", 210, ["Fantasy"], ["Adventurous"])
    assert d.cover_url == "https://assets.hardcover.app/c.jpg" and d.year == 2001 and d.external_ids["hardcover"] == "8"


@respx.mock
def test_rawg_fetch_endless_and_dlc():
    base = "https://api.rawg.io/api"
    respx.get(f"{base}/games/3498").mock(return_value=Response(200, json={
        "id": 3498, "slug": "gta-v", "name": "Grand Theft Auto V", "released": "2013-09-17", "tba": False, "playtime": 74,
        "description_raw": "Crime.", "genres": [{"name": "Action"}], "tags": [{"slug": "open-world", "name": "Open World", "language": "eng"}],
        "platforms": [{"platform": {"name": "PC"}}], "developers": [{"id": 1, "name": "Rockstar North"}], "publishers": [],
        "background_image": "https://media.rawg.io/x.jpg", "stores": [{"store": {"name": "Steam"}}]}))
    respx.get(f"{base}/games/3498/additions").mock(return_value=Response(200, json={"results": [{"id": 9, "name": "Online", "released": "2013-10-01"}]}))
    respx.get(f"{base}/games/3498/game-series").mock(return_value=Response(200, json={"results": [{"id": 4, "name": "GTA IV", "released": "2008-04-29"}]}))
    respx.get(f"{base}/games/3498/screenshots").mock(return_value=Response(200, json={"results": [{"image": "https://media.rawg.io/s.jpg"}]}))
    d = run(rawg.fetch("3498"))
    assert d.status == "released" and not d.endless and d.details["playtime_hours"] == 74
    assert d.details["dlc"][0]["name"] == "Online" and d.recommendations[0].title == "GTA IV"
    assert d.details["platforms"] == ["PC"] and d.people[0].role == "developer"


@respx.mock
def test_cache_write_never_fails_a_request_while_the_caller_holds_the_write_lock():
    """Regression: a job holding an open write transaction used to make the cache write raise 'database is locked'."""
    from sqlmodel import Session

    from app.models_media import Item

    respx.get("https://x.test/busy").mock(return_value=Response(200, json={"ok": 1}))
    c = Client("X", "https://x.test", rate=100)
    with Session(db.engine) as s:
        s.add(Item(kind="book", title="held"))
        s.flush()  # the caller's write transaction is open
        assert run(c.get("/busy")) == {"ok": 1}
        s.rollback()


def test_openlibrary_search_keeps_the_richest_copy_of_a_book_and_ranks_it_first():
    from app.providers import openlibrary as ol

    docs = [
        {"key": "/works/A", "title": "The Hobbit", "author_name": ["J.R.R. Tolkien"], "edition_count": 3},
        {"key": "/works/B", "title": "The Hobbit: companion", "author_name": ["David Day"], "edition_count": 2},
        {"key": "/works/C", "title": "The hobbit", "author_name": ["J.R.R. Tolkien"], "edition_count": 480, "cover_i": 1},
        {"key": "/works/D", "title": "The Hobbit", "edition_count": 1},  # no author: the same book
        {"key": "/works/E", "title": "The Hobbit", "author_name": ["Charles Dixon"], "edition_count": 10},
    ]
    kept = ol.dedupe(docs)
    assert [d["key"] for d in kept] == ["/works/C", "/works/B", "/works/E"]
    assert ol.rank("the hobbit", kept)[0]["key"] == "/works/C"
