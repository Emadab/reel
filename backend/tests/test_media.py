"""Shows, books and games: flags, the transition table, show state derivation (specials, revivals, new
episodes, sticky states), episode ticks, up next, book progress, game hours, reruns."""
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlmodel import Session, select

from app import books, db, games, shows
from app.models_media import Event, Item, Run
from app.providers import rawg
from app.providers.base import EpisodeData, ItemData, SeasonData
from app.status import allowed, transition

PAST = datetime(2020, 1, 1, tzinfo=UTC)
FUTURE = datetime(2099, 1, 1, tzinfo=UTC)
SHOW = {"status": "returning", "future_ep": True}


def show_data(ext_id: str) -> ItemData:
    eps = [EpisodeData(0, 1, "Special", airstamp_utc=PAST),
           EpisodeData(1, 1, "Pilot", airstamp_utc=PAST), EpisodeData(1, 2, "Two", airstamp_utc=PAST + timedelta(days=7))]
    if SHOW["future_ep"]:
        eps.append(EpisodeData(2, 1, "Return", airstamp_utc=FUTURE))
    return ItemData(kind="show", title="Severance", external_ids={"tmdb_tv": ext_id, "imdb": "tt11280740"}, year=2022,
                    genres=["Drama", "Mystery"], status=SHOW["status"], details={"networks": ["Apple TV+"]},  # type: ignore[arg-type]
                    seasons=[SeasonData(0, "Specials"), SeasonData(1, "Season 1"), SeasonData(2, "Season 2")], episodes=eps)


@pytest.fixture
def media(client, monkeypatch):
    SHOW.update(status="returning", future_ep=True)

    async def fake_show(ext_id):
        return show_data(ext_id)

    async def fake_book(work_id):
        return ItemData(kind="book", title="Piranesi", external_ids={"openlibrary": work_id, "isbn13": f"isbn-{work_id}"},
                        year=2020, genres=["Fantasy"], details={"pages": 272, "authors": ["Susanna Clarke"]})

    async def fake_game(ext_id, kind="game"):
        endless = ext_id == "2"
        return ItemData(kind="game", title="Valheim" if endless else "Hades", external_ids={"rawg": ext_id}, year=2020,
                        endless=endless, details={"playtime_hours": 20, "platforms": ["PC"]})

    monkeypatch.setattr(shows, "fetch_show", fake_show)
    monkeypatch.setattr(books, "fetch_book", fake_book)
    monkeypatch.setattr(rawg, "fetch", fake_game)
    client.put("/api/settings", json={"flags": {"media.shows": True, "media.books": True, "media.games": True}})
    return client


def detail(c, item_id):
    return c.get(f"/api/media/items/{item_id}").json()


def ep_id(d, season, number):
    return next(e["id"] for s in d["seasons"] for e in s["episodes"] if (e["season"], e["number"]) == (season, number))


def tick(c, item_id, ids, watched=True):
    r = c.post(f"/api/media/items/{item_id}/episodes", json={"episode_ids": ids, "watched": watched})
    assert r.status_code == 200, r.text
    return r.json()


# ---- the transition table ----

def test_transition_table():
    assert allowed("show", None) == ["watching"]
    assert allowed("game", "playing", endless=True) == ["abandoned", "retired", "shelved"]
    assert allowed("book", "did_not_finish") == ["reading"]
    with Session(db.engine) as s:
        run = Run(item_id=1, status="reading")
        with pytest.raises(HTTPException) as e:
            transition(s, run, "book", "dipping")
        assert e.value.status_code == 409 and e.value.detail["allowed"] == ["did_not_finish", "finished", "paused"]
        run.status = "paused"
        assert transition(s, run, "book", "finished", source="derived") is False  # sticky wins
        assert run.status == "paused"


def test_flags_hide_everything(client):
    assert client.get("/api/media/show/library").status_code == 404
    assert client.get("/api/media/book/search", params={"q": "piranesi"}).status_code == 404
    assert client.get("/api/media/shows/up-next").status_code == 404


# ---- shows ----

def test_show_states_watching_caught_up_and_new_episode(media, monkeypatch):
    card = media.post("/api/media/show/items", json={"ext_id": "95396", "shelf": "wishlist"}).json()
    assert card["status"] == "wishlist" and card["subtitle"] == "Apple TV+"
    d = detail(media, card["id"])
    assert d["allowed"] == ["watching"] and [s["number"] for s in d["seasons"]] == [0, 1, 2]

    d = tick(media, card["id"], [ep_id(d, 1, 1)])
    assert d["status"] == "watching" and d["progress"] == {"watched": 1, "aired": 2, "total": 3} and d["shelf"] is None
    d = tick(media, card["id"], [ep_id(d, 0, 1)])  # a special never counts
    assert d["progress"]["watched"] == 1 and d["status"] == "watching"
    assert d["next_episode"]["number"] == 2 and d["upcoming_episode"]["season"] == 2
    up = media.get("/api/media/shows/up-next").json()
    assert up[0]["item"]["id"] == card["id"] and up[0]["episode"]["number"] == 2

    d = tick(media, card["id"], [ep_id(d, 1, 2)])
    assert d["status"] == "caught_up" and d["next_episode"] is None
    assert tick(media, card["id"], [ep_id(d, 2, 1)])["progress"]["watched"] == 2  # unaired: ignored

    monkeypatch.setattr(shows, "now", lambda: datetime(2100, 1, 1, tzinfo=UTC))  # S2E1 airs
    with Session(db.engine) as s:
        shows.rederive_all(s)
    assert detail(media, card["id"])["status"] == "watching"


def test_show_collection_lists_its_franchise(media, monkeypatch):
    async def fake_collection(tmdb_id, title):
        hit = lambda i, name, year: {"kind": "show", "source": "tmdb_tv", "ext_id": i, "title": name, "year": year, "subtitle": None, "cover_url": None}  # noqa: E731
        return {"name": "Breaking Bad", "parts": [hit("1396", "Breaking Bad", 2008), hit(tmdb_id, title, 2015)]}

    monkeypatch.setattr(shows, "collection", fake_collection)
    card = media.post("/api/media/show/items", json={"ext_id": "60059"}).json()
    c = detail(media, card["id"])["collection"]
    assert c["name"] == "Breaking Bad" and [i["title"] for i in c["items"]] == ["Breaking Bad", "Severance"]
    other = c["items"][0]
    assert not other["in_library"] and detail(media, other["id"])["title"] == "Severance"  # a light item opens in full


def test_show_completed_revival_and_season_ticks(media):
    SHOW.update(status="ended", future_ep=False)
    item_id = media.post("/api/media/show/items", json={"ext_id": "1"}).json()["id"]
    d = media.post(f"/api/media/items/{item_id}/episodes", json={"season": 1}).json()
    assert d["status"] == "completed" and d["runs"][0]["finished_on"] is not None  # backfill straight to a final state

    SHOW.update(status="returning", future_ep=False)  # revived: renewed, nothing new aired yet
    d = media.post(f"/api/media/items/{item_id}/refresh").json()
    assert d["status"] == "caught_up"

    d = tick(media, item_id, [ep_id(d, 1, 2)], watched=False)
    assert d["status"] == "watching" and d["progress"]["watched"] == 1


def test_episode_dates_with_precision_and_redating(media):
    item_id = media.post("/api/media/show/items", json={"ext_id": "7"}).json()["id"]
    d = detail(media, item_id)
    e1, e2 = ep_id(d, 1, 1), ep_id(d, 1, 2)
    r = media.post(f"/api/media/items/{item_id}/episodes", json={"episode_ids": [e1], "watched_on": "2021-03-17", "date_precision": "month"}).json()
    ep = next(e for e in r["seasons"][1]["episodes"] if e["id"] == e1)
    assert (ep["watched_on"], ep["watched_precision"]) == ("2021-03-01", "month")
    r = media.post(f"/api/media/items/{item_id}/episodes", json={"episode_ids": [e1], "date_precision": "unknown"}).json()  # re-date
    ep = next(e for e in r["seasons"][1]["episodes"] if e["id"] == e1)
    assert (ep["watched_on"], ep["watched_precision"]) == ("0001-01-01", "unknown")
    r = tick(media, item_id, [e2])  # a plain tick is today
    assert next(e for e in r["seasons"][1]["episodes"] if e["id"] == e2)["watched_precision"] == "day"
    assert media.get("/api/media/show/stats").json()["kpis"]["episodes"] == 2  # unknown still counts


def test_add_history_whole_show_or_up_to_a_season(media):
    SHOW.update(status="ended", future_ep=False)
    item_id = media.post("/api/media/show/items", json={"ext_id": "8"}).json()["id"]
    d = media.post(f"/api/media/items/{item_id}/history",
                   json={"started_on": "2015-02-10", "finished_on": "2015-06-20", "date_precision": "year", "rating": 9}).json()
    run = d["runs"][0]
    assert d["status"] == "completed" and d["progress"]["watched"] == 2 and run["rating"] == 9
    assert (run["started_on"], run["finished_on"], run["date_precision"]) == ("2015-01-01", "2015-01-01", "year")
    assert media.get("/api/media/show/timeline", params={"year": 2015}).json()["totals"]["finished"] == 1
    # all of it is already watched: adding it again is another time through
    d = media.post(f"/api/media/items/{item_id}/history", json={"date_precision": "unknown"}).json()
    assert len(d["runs"]) == 2 and d["runs"][1]["date_precision"] == "unknown" and d["runs"][1]["finished_on"] == "0001-01-01"
    assert media.post(f"/api/media/items/{item_id}/history", json={"upto_season": 0}).status_code == 422


def test_add_history_on_release_dates(media):
    SHOW.update(status="ended", future_ep=False)
    item_id = media.post("/api/media/show/items", json={"ext_id": "9"}).json()["id"]
    d = media.post(f"/api/media/items/{item_id}/history", json={"on_air_dates": True, "date_precision": "day"}).json()
    regular = [e for s in d["seasons"] if s["number"] > 0 for e in s["episodes"]]
    assert [e["watched_on"] for e in regular] == ["2020-01-01", "2020-01-08"]
    run = d["runs"][0]
    assert d["status"] == "completed" and (run["started_on"], run["finished_on"], run["date_precision"]) == ("2020-01-01", "2020-01-08", "day")


def test_run_dates_follow_precision(media):
    item_id = media.post("/api/media/book/items", json={"ext_id": "OL1W", "status": "reading"}).json()["id"]
    run_id = detail(media, item_id)["runs"][0]["id"]
    r = media.patch(f"/api/media/runs/{run_id}", json={"started_on": "2019-07-20", "date_precision": "month"}).json()
    assert r["runs"][0]["started_on"] == "2019-07-01"
    r = media.patch(f"/api/media/runs/{run_id}", json={"date_precision": "unknown"}).json()
    assert r["runs"][0]["started_on"] == "0001-01-01"
    assert media.patch(f"/api/media/runs/{run_id}", json={"clear_started": True}).json()["runs"][0]["started_on"] is None


def test_sticky_show_states_are_never_derived_over(media, monkeypatch):
    item_id = media.post("/api/media/show/items", json={"ext_id": "2", "status": "watching"}).json()["id"]
    d = media.post(f"/api/media/items/{item_id}/status", json={"status": "on_hold"}).json()
    assert d["status"] == "on_hold" and d["sticky"] and d["allowed"] == ["dropped", "watching"]
    r = media.post(f"/api/media/items/{item_id}/status", json={"status": "completed"})
    assert r.status_code == 409 and r.json()["detail"]["allowed"] == ["dropped", "watching"]
    d = media.post(f"/api/media/items/{item_id}/episodes", json={"season": 1}).json()
    assert d["status"] == "on_hold" and d["progress"]["watched"] == 2
    monkeypatch.setattr(shows, "now", lambda: datetime(2100, 1, 1, tzinfo=UTC))
    with Session(db.engine) as s:
        shows.rederive_all(s)
    assert detail(media, item_id)["status"] == "on_hold"
    d = media.post(f"/api/media/items/{item_id}/status", json={"status": "watching"}).json()
    assert d["status"] == "watching"  # resuming lands on the real derived state (S2E1 aired, unwatched)


def test_inactivity_suggests_on_hold_without_changing_state(media):
    item_id = media.post("/api/media/show/items", json={"ext_id": "3"}).json()["id"]
    d = tick(media, item_id, [ep_id(detail(media, item_id), 1, 1)])
    assert d["suggest"] is None
    with Session(db.engine) as s:
        for ev in s.exec(select(Event).where(Event.item_id == item_id)):
            ev.occurred_at = datetime.now(UTC) - timedelta(weeks=7)
            s.add(ev)
        s.commit()
    d = detail(media, item_id)
    assert d["suggest"] == "on_hold" and d["status"] == "watching"


def test_search_marks_library_items(media, monkeypatch):
    from app.providers.base import SearchHit
    from app.providers.tmdb_tv import provider

    async def fake_search(q, kind="show"):
        return [SearchHit("show", "tmdb_tv", "95396", "Severance", 2022)]

    monkeypatch.setattr(provider, "search", fake_search)
    item_id = media.post("/api/media/show/items", json={"ext_id": "95396"}).json()["id"]
    r = media.get("/api/media/show/search", params={"q": "sever"}).json()
    assert r["local"][0]["id"] == item_id and r["results"][0]["item_id"] == item_id
    again = media.post("/api/media/show/items", json={"ext_id": "95396"}).json()
    assert again["id"] == item_id  # no duplicates


# ---- books ----

def test_book_flow_backlog_progress_finish_rate_reread(media):
    card = media.post("/api/media/book/items", json={"ext_id": "OL1W", "shelf": "backlog"}).json()
    assert card["status"] == "backlog"
    d = media.post(f"/api/media/items/{card['id']}/status", json={"status": "reading"}).json()
    assert d["status"] == "reading" and d["shelf"] is None
    run_id = d["runs"][0]["id"]
    d = media.post(f"/api/media/runs/{run_id}/progress", json={"unit": "page", "current": 100}).json()
    assert d["progress"] == {"unit": "page", "current": 100, "total": 272} and d["status"] == "reading"
    d = media.post(f"/api/media/runs/{run_id}/progress", json={"current": 272}).json()
    assert d["status"] == "finished"  # derived at 100%
    d = media.patch(f"/api/media/runs/{run_id}", json={"rating": 9.5}).json()
    assert d["my_rating"] == 9.5
    d = media.post(f"/api/media/items/{card['id']}/runs", json={"status": "reading"}).json()
    assert [r["run_no"] for r in d["runs"]] == [1, 2] and d["runs"][0]["status"] == "finished" and d["status"] == "reading"
    lib = media.get("/api/media/book/library", params={"status": ["reading"]}).json()
    assert lib["counts"]["reading"] == 1 and lib["items"][0]["id"] == card["id"]


def test_paused_book_is_not_finished_by_progress(media):
    item_id = media.post("/api/media/book/items", json={"ext_id": "OL2W", "status": "reading"}).json()["id"]
    d = media.post(f"/api/media/items/{item_id}/status", json={"status": "paused"}).json()
    d = media.post(f"/api/media/runs/{d['runs'][0]['id']}/progress", json={"unit": "percent", "current": 100}).json()
    assert d["status"] == "paused"


# ---- games ----

def test_game_hours_goal_and_time_left(media):
    item_id = media.post("/api/media/game/items", json={"ext_id": "1"}).json()["id"]
    d = media.post(f"/api/media/items/{item_id}/runs", json={"status": "playing", "goal": "completionist"}).json()
    run_id = d["runs"][0]["id"]
    assert d["time_left"] == 52.0
    d = media.post(f"/api/media/runs/{run_id}/progress", json={"hours": 12.5}).json()
    assert d["time_left"] == 39.5 and d["progress"]["hours"] == 12.5
    d = media.post(f"/api/media/items/{item_id}/status", json={"status": "beaten"}).json()
    assert d["allowed"] == ["completed", "playing"]


def test_endless_game_and_sticky_states_survive_hours(media):
    item_id = media.post("/api/media/game/items", json={"ext_id": "2", "status": "playing"}).json()["id"]
    d = detail(media, item_id)
    assert d["endless"] and "beaten" not in d["allowed"] and d["time_left"] is None
    for sticky in ("shelved", "abandoned"):
        d = media.post(f"/api/media/items/{item_id}/status", json={"status": sticky}).json()
        d = media.post(f"/api/media/runs/{d['runs'][0]['id']}/progress", json={"hours": 50}).json()
        assert d["status"] == sticky
        if sticky == "shelved":
            media.post(f"/api/media/items/{item_id}/status", json={"status": "playing"})
    with Session(db.engine) as s:
        run = s.exec(select(Run).where(Run.item_id == item_id)).one()
        run.status = "retired"
        assert transition(s, run, "game", "playing", source="derived") is False


def test_game_time_left_estimate_unit():
    item = Item(kind="game", title="X", details={"playtime_hours": 10})
    assert games.estimate(item, "main_extras") == 16.0
    assert games.time_left(item, Run(item_id=1, progress={"hours": 4})) == 6.0
    assert date.today()  # keeps the import used


def test_run_variant_format_and_platform(media):
    item_id = media.post("/api/media/book/items", json={"ext_id": "OL3W", "status": "reading"}).json()["id"]
    run_id = media.get(f"/api/media/items/{item_id}").json()["runs"][0]["id"]
    d = media.patch(f"/api/media/runs/{run_id}", json={"variant": {"format": "audio"}}).json()
    assert d["runs"][0]["variant"] == {"format": "audio"}
    d = media.post(f"/api/media/runs/{run_id}/progress", json={"unit": "minutes", "current": 30, "total": 600}).json()
    assert d["progress"]["unit"] == "minutes" and d["status"] == "reading"


def test_show_run_dates_follow_first_and_last_episode(media):
    SHOW.update(status="ended", future_ep=False)
    item_id = media.post("/api/media/show/items", json={"ext_id": "9"}).json()["id"]
    d = detail(media, item_id)
    e1, e2 = ep_id(d, 1, 1), ep_id(d, 1, 2)
    media.post(f"/api/media/items/{item_id}/episodes", json={"episode_ids": [e2], "watched_on": "2021-04-02"})
    d = media.post(f"/api/media/items/{item_id}/episodes", json={"episode_ids": [e1], "watched_on": "2021-03-17"}).json()
    run = d["runs"][0]
    assert d["status"] == "completed" and (run["started_on"], run["finished_on"], run["date_precision"]) == ("2021-03-17", "2021-04-02", "day")
    d = media.post(f"/api/media/items/{item_id}/episodes", json={"episode_ids": [e1], "watched_on": "2020-11-20", "date_precision": "month"}).json()
    run = d["runs"][0]
    assert (run["started_on"], run["finished_on"], run["date_precision"]) == ("2020-11-01", "2021-04-01", "month")  # the coarser wins
    d = tick(media, item_id, [e2], watched=False)
    assert d["runs"][0]["finished_on"] is None  # no longer finished


def test_library_filters_and_watch_date_sort(media):
    add = lambda ext, **b: media.post("/api/media/book/items", json={"ext_id": ext, **b}).json()["id"]  # noqa: E731
    old = add("OL1W", status="reading", started_on="2019-05-01")
    new = add("OL2W", status="reading", started_on="2024-02-02")
    wish = add("OL3W", shelf="wishlist")
    lib = lambda **p: [i["id"] for i in media.get("/api/media/book/library", params=p).json()["items"]]  # noqa: E731
    assert set(lib(status="reading")) == {old, new} and lib(status="wishlist") == [wish]
    assert set(lib(genre="Fantasy")) == {old, new, wish} and lib(genre="Comedy") == []
    assert lib(sort="watched") == [new, old, wish]  # never started goes last
