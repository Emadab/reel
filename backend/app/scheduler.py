"""In-process scheduler: checks once a minute which jobs are due (by SyncState.last_run_at, so a restart catches up
on whatever it missed) and hands them to the existing job worker, which already runs each name once at a time."""
import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import timedelta

from sqlmodel import Session

from . import announce, db, jobs, notify, shows
from .flags import enabled
from .items import utc

log = logging.getLogger("reel.scheduler")
TICK = 60

# (job, provider key in SyncState, interval, flag that must be on, the work)
Job = tuple[str, str, timedelta, str, Callable[[Session], Awaitable[object] | object]]
JOBS: list[Job] = [
    ("show_updates", "tvmaze", timedelta(hours=6), "media.shows", announce.show_updates),
    ("airing", "reel", timedelta(minutes=15), "media.shows", announce.airing),
    ("movie_releases", "tmdb", timedelta(days=1), "", announce.movie_releases),
    ("book_follows", "books", timedelta(days=7), "media.books", announce.book_follows),
    ("game_releases", "rawg", timedelta(days=1), "media.games", announce.game_releases),
]


def due(s: Session, provider: str, job: str, every: timedelta) -> bool:
    st = s.get(announce.SyncState, (provider, job))
    if job == "book_follows":  # one state row per follow; use the job marker row
        st = s.get(announce.SyncState, ("books", "job"))
    return not st or not st.last_run_at or announce.now() - utc(st.last_run_at) >= every


def _runner(name: str, fn) -> Callable[[], Awaitable[None]]:
    async def run() -> None:
        with Session(db.engine) as s:
            out = fn(s)
            if asyncio.iscoroutine(out):
                await out
            if name == "book_follows":
                announce.state(s, "books", "job").last_run_at = announce.now()
                s.commit()
            await notify.deliver(s)
    return run


def tick() -> None:
    with Session(db.engine) as s:
        if enabled(s, "media.shows"):
            jobs.enqueue("derive:shows", _derive)  # time passing airs episodes
        if not enabled(s, "announcements"):
            return
        for name, provider, every, flag, fn in JOBS:
            if (not flag or enabled(s, flag)) and due(s, provider, name, every):
                jobs.enqueue(f"announce:{name}", _runner(name, fn))


async def _derive() -> None:
    with Session(db.engine) as s:
        shows.rederive_all(s)


async def loop() -> None:
    while True:
        try:
            tick()
        except Exception:  # the scheduler must outlive any one bad tick
            log.exception("scheduler tick failed")
        await asyncio.sleep(TICK)


def start() -> asyncio.Task:
    return asyncio.create_task(loop())
