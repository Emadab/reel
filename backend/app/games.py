"""Games: hours and percent logging, and the time-left estimate.
RAWG gives one average playtime; goals scale it (main 1x, main + extras 1.6x, completionist 2.6x)."""
from sqlmodel import Session

from .models_media import Event, Item, Run
from .status import transition

# ponytail: fixed multipliers stand in for IGDB's per-goal time-to-beat; use real figures if IGDB is added
GOAL_FACTOR = {"main": 1.0, "main_extras": 1.6, "completionist": 2.6}


def estimate(item: Item, goal: str | None) -> float | None:
    avg = item.details.get("playtime_hours")
    return round(avg * GOAL_FACTOR.get(goal or "main", 1.0), 1) if avg and not item.endless else None


def time_left(item: Item, run: Run | None) -> float | None:
    est = estimate(item, run.goal if run else None)
    if est is None:
        return None
    played = (run.progress.get("hours") or 0) if run else 0
    return round(max(est - played, 0), 1)


def log_hours(s: Session, item: Item, run: Run, hours: float | None, percent: float | None) -> None:
    p = dict(run.progress)
    before = p.get("hours") or 0
    if hours is not None:
        p["hours"] = hours
    if percent is not None:
        p["percent"] = percent
    run.progress = p
    s.add(run)
    s.add(Event(item_id=item.id, run_id=run.id, kind="session",  # type: ignore[arg-type]
                payload={"hours": p.get("hours"), "delta": round((p.get("hours") or 0) - before, 2), "percent": p.get("percent")}))
    if run.status is None and (p.get("hours") or 0) > before:
        transition(s, run, "game", "playing", source="derived")  # derived: never overrides a sticky run
