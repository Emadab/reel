# Phase 5 report: announcements

Branch `expansion/phase-5-announcements`, stacked on phase 4.

## Commits
- `ea4c57f` Tests: cold media cache per test; characterization drains after every write
  - The movie golden file was regenerated, then **generated again on a pristine `main` worktree: byte-identical**.
  - `git diff main` shows no change to any movie module (routers, tmdb, cards, recommender, models, importers, omdb).
- `7105d0b` Announcement jobs, diff engine, scheduler, notification delivery (toast, ntfy, quiet hours)
- `a4be3fd` Notification, calendar and follow API, plus media settings (keys, ntfy, quiet hours, per-mode accents)
- `e9deffa` Notification bell, calendar pages, follow controls

## What exists
- **Scheduler** (`app/scheduler.py`): checks once a minute which jobs are due, based on `syncstate.last_run_at`. Startup therefore catches up on anything missed while Reel was closed. Due jobs run on the existing job worker.

  | Job | Interval | Flag |
  | --- | --- | --- |
  | Show updates: TVmaze update feed since the last run; changed followed shows are refetched and diffed. A full refresh happens if the last run is over 30 days old. | 6 h | `media.shows` |
  | Air-time check: episodes that aired since the last tick | 15 min | `media.shows` |
  | Movie digital releases for your watchlist (TMDB release dates, read-only use of the movie tables) | daily | none |
  | Followed authors (Open Library) and series (Hardcover) | weekly | `media.books` |
  | Wishlisted game release dates and releases; new DLC for games you've beaten (RAWG) | daily | `media.games` |

  All of these also need `announcements` on. Show states are re-derived as episodes air whenever `media.shows` is on.
- **Diff engine:**
  - It detects:
    - a new season announced
    - a moved air date
    - an episode aired
    - a renewal
    - a cancellation or ending
  - Each notification has a `dedupe_key` (e.g. `season:12:3:announced`, `movie:329865:digital_release`), so jobs are idempotent.
  - Same-day episodes of one show collapse into one notification ("2 new episodes are out").
  - On-hold, dropped or muted items get nothing.
- **Delivery:**
  - In-app bell next to Settings, with an unread badge and a panel. Clicking a notification opens its item.
  - Desktop toasts through Windows PowerShell's WinRT bridge, so **no new dependency** (I said I'd ask about `winotify`; it turned out not to be needed). Verified: a real toast was shown on this machine.
  - Optional ntfy push to a topic you set.
  - Quiet hours (e.g. `23:00-08:00`, wrapping midnight) hold delivery, then send one digest.
  - Episode-aired alerts go to desktop and phone only for shows you mark **"Alert me at air time"**; the rest stay in-app.
- **Calendar page** in each media mode: an agenda of what's coming in the next 90 days, with local air times.
- **Follow controls** in the detail page's More menu: alert at air time, mute news, follow a book's author or series.

## Migrations
- Additive tables: `follow`, `notification`, `syncstate`. An automatic pre-migration snapshot is taken on first start.
- Rollback: restore that snapshot, or drop the three tables.

## Tests
- Backend: **54 passed**, five full runs in a row.
- The 10 new tests cover:
  - Diff cases: new season, cancellation, date moved, renewal (and idempotency).
  - Same-day collapse and running the job twice.
  - Sticky and muted shows getting no alerts.
  - Show updates refetching only what changed.
  - Quiet hours holding, then a digest.
  - Quiet window wrapping midnight.
  - Movie digital release.
  - Followed author's new book (the first run only learns what exists).
  - Game date move, release and DLC.
  - The notification API, item paths, flag hiding.
- Frontend: typecheck clean, unit 4/4, visual **7/7**.
- Live, on a copy of your data with real providers: all six jobs ran with no errors.
  - Adding The Simpsons and SNL filled the calendar with real TVmaze airstamps.
  - Bell, calendar and menu screenshots were checked.
  - Desktop toasts were off on the copy.

## Manual checks
1. Turn on `announcements` (Settings → Media, Phase 8), add a show that is airing, open Calendar in Shows mode.
2. On its page, More → "Alert me at air time".
3. Optionally set an ntfy topic and quiet hours in Settings.

## Deviations
- Air-time alerts run for every followed show; "high priority" only decides whether they reach the desktop and phone.
- Air times fall back to midnight UTC on the air date when TVmaze doesn't know a show.

## Proposal (not implemented): background running
Reel's backend lives inside the desktop window, so announcements only run while Reel is open. Startup catch-up covers the gap. If you want alerts with the window closed, the smallest option is a "Start Reel minimized to the tray at login" setting:
- a Startup-folder shortcut, plus a hidden-window mode in `desktop.py`, using pywebview's `hidden=True`;
- no new service or dependency.

Say yes if you want it.

## Open questions
None blocking.
