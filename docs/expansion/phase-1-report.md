# Phase 1 report: safety net

Branch `expansion/phase-1-safety` (from `main` at fc63032).

## Commits
- `c17e54f` Move expansion plan to docs/expansion. The folder was misspelled `docs/expantion`.
- `6f090ce` Add backup/restore scripts and snapshot before schema changes
- `ed6a9db` Pin movie behaviour with a golden characterization test
- `0612073` Add feature flags (all off) exposed through /api/settings

## Migrations
None. `db.migrate()` now snapshots an existing database (and `media/`) into `backend/data/backups/<ts>-pre-migration/` before it creates a table or adds a column. To roll back, restore the snapshot with `scripts/restore.py`.

## Tests
- Backend: **22 passed**. That is the 18 existing tests, the golden movie characterization test, and 3 safety tests (snapshot/restore round trip, the pre-migration guard, flags).
- The characterization test plays a full movie session against the fake TMDB:
  - search
  - watchlist
  - log, edit and delete watches
  - detail and refresh
  - library (every tab × sort, filters, facets)
  - timeline, years, stats
  - onboarding, recommendations (all filters), feedback, taste map, explain
  - Letterboxd and IMDb imports
  It records every response plus the final `watch`, `watchlist` and `feedback` rows, about 210 KB of JSON in `tests/golden/movies.json`. The golden file was generated on unmodified app code, and "today" is frozen at 2026-10-05. Ties in top-N lists that the app builds from sets are unnamed, because their order depends on Python's hash seed.
- Frontend: typecheck and unit tests pass, and the visual tests (fixture mode) give **7/7 passed**.
- Backup/restore was round-tripped on a **copy** of the real database (121 watches → deleted → restored 121). The real `backend/data` was only read.

## Manual checks
1. `uv run --project backend python scripts/backup.py` prints a snapshot folder.
2. Open Reel. Everything looks and behaves exactly as before.

## Deviations
- **Lean path (approved in planning):** movies keep their own tables. The doc's `core.dual_write` and `core.v2_reads` flags, Phase 2 and Phase 9 are dropped. Shows, books and games live in new tables.
- The snapshots go in `backend/data/backups/` instead of a repo-root `backups/`, so they stay with the data and are already git-ignored.
- No new Playwright smoke test. The existing visual suite already drives every movie screen in fixture mode.

## Open questions
None.
