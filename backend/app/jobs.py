"""A single in-process worker for background work (images, embeddings, recommendations, UMAP).
Jobs are keyed by name: enqueueing a name that is already pending is a no-op, so every job is idempotent."""
import asyncio
import logging
import traceback
from collections.abc import Awaitable, Callable

log = logging.getLogger("reel.jobs")

_queue: asyncio.Queue[tuple[str, Callable[[], Awaitable[None]]]] | None = None
_pending: set[str] = set()
status: dict[str, dict] = {}  # name -> {state, done, total, error}


def enqueue(name: str, fn: Callable[[], Awaitable[None]]) -> None:
    if _queue is None or name in _pending:
        return
    _pending.add(name)
    status[name] = {"state": "queued", "done": 0, "total": 0, "error": None}
    _queue.put_nowait((name, fn))


def progress(name: str, done: int, total: int) -> None:
    if name in status:
        status[name].update(done=done, total=total)


async def _worker() -> None:
    assert _queue is not None
    while True:
        name, fn = await _queue.get()
        _pending.discard(name)
        status[name]["state"] = "running"
        try:
            await fn()
            status[name]["state"] = "done"
        except Exception as e:  # a failed job must not kill the worker
            status[name].update(state="failed", error=str(e))
            log.error("job %s failed\n%s", name, traceback.format_exc())
        finally:
            _queue.task_done()


def start() -> asyncio.Task:
    global _queue
    _queue = asyncio.Queue()
    return asyncio.create_task(_worker())


async def drain() -> None:
    """Wait until the queue is empty (tests)."""
    if _queue is not None:
        await _queue.join()
