"""The one place a run's status changes (REEL_EXPANSION §5.3). Every change is checked against TRANSITIONS
and logged as a status_change event. Derived changes (from automation) never touch a sticky state and
never fail loudly; user changes that aren't allowed raise 409 with the allowed next states."""
from datetime import UTC, date, datetime

from fastapi import HTTPException
from sqlmodel import Session

from .models_media import Event, Run

TRANSITIONS: dict[str, dict[str | None, set[str]]] = {
    "movie": {None: {"in_progress", "watched", "abandoned"},
              "in_progress": {"watched", "abandoned"}},
    "show": {None: {"watching"},
             "watching": {"caught_up", "completed", "on_hold", "dropped"},
             "caught_up": {"watching", "completed", "dropped"},
             "completed": {"caught_up"},
             "on_hold": {"watching", "dropped"}, "dropped": {"watching"}},
    "book": {None: {"reading", "finished", "dipping"},
             "reading": {"paused", "finished", "did_not_finish"},
             "paused": {"reading", "did_not_finish"}, "dipping": {"reading", "finished"},
             "did_not_finish": {"reading"}},
    "game": {None: {"playing", "beaten", "completed"},
             "playing": {"shelved", "beaten", "completed", "abandoned", "retired"},
             "shelved": {"playing", "abandoned"}, "beaten": {"playing", "completed"},
             "abandoned": {"playing"}},
}
STICKY = {"on_hold", "dropped", "paused", "did_not_finish", "shelved", "abandoned", "retired"}
FINISHED = {"completed", "finished", "beaten"}
STARTED = {"watching", "reading", "dipping", "playing"}
DERIVED_SHOW = {"watching", "caught_up", "completed"}


def allowed(kind: str, current: str | None, endless: bool = False) -> list[str]:
    nxt = TRANSITIONS[kind].get(current, set())
    if endless:  # games without an ending skip beaten/completed
        nxt = nxt - {"beaten", "completed"}
    return sorted(nxt)


def transition(s: Session, run: Run, kind: str, new: str, source: str = "user", endless: bool = False,
               when: date | None = None) -> bool:
    """Apply `new` to `run`. Returns True if the status changed. Caller commits."""
    old = run.status
    if new == old:
        return False
    if source == "derived":
        if old in STICKY:
            return False  # sticky states win
        # backfill: a run with no state yet may start straight in a derived final state (e.g. a whole season ticked)
        ok = new in allowed(kind, old, endless) or (old is None and kind == "show" and new in DERIVED_SHOW)
        if not ok:
            return False
    elif new not in allowed(kind, old, endless):
        raise HTTPException(409, {"message": f"Can't go from {old or 'not started'} to {new}",
                                  "allowed": allowed(kind, old, endless)})
    today = when or date.today()
    if new in STARTED and run.started_on is None:
        run.started_on = today
    if new in FINISHED and run.finished_on is None:
        run.finished_on = today
    run.status, run.status_source = new, source
    run.updated_at = datetime.now(UTC)
    s.add(run)
    s.add(Event(item_id=run.item_id, run_id=run.id, kind="status_change",
                payload={"from": old, "to": new, "source": source}))
    return True
