# Phase 8 report: cross-media features and imports

Branch `expansion/phase-8-cross-media`, stacked on phase 7.

## Commits
- `6cee9e2` Per-medium timeline and stats, and the all-media summary
- `8f06890` Per-medium recommendations and taste maps driven by tracking-state signals
- `c145cbe` Goodreads, StoryGraph and IMDb TV imports with review and no duplicates
- `cd85707` Never let a cache write deadlock a job: commit per step, best-effort cache writes
- `4bdf7c1` Per-medium Timeline, Stats (with All media), For you, Taste map and Import pages
- `(next)` README section and this report

## What exists
In every media mode, the sidebar now has the same sections as movies: Library, Timeline, Stats, For you, Taste map, and Calendar (with announcements on).

- **Timeline:**
  - Month columns of what you completed / finished / beat, each with that month's activity (episodes, reading updates, sessions).
  - Dashed outlines for month-only dates, and a "Sometime in 2019" column for year-only dates; it never shows a fake day.
  - The same Every-year bars as the movie Timeline.
- **Stats:**
  - Tiles: finishes, hours watched or played (shows also count episodes), pages read, drop / DNF rate, average rating, active days.
  - Charts: active-days heatmap, genre radar, people bar lists (networks and creators / authors and subjects / developers and platforms), ratings histogram.
  - Every chart has the existing "View as table".
  - **All media** puts every enabled medium side by side: finishes, hours, pages, drop and DNF rates. Movies are included **read-only**.
- **For you:**
  - Per-medium suggestions, using the movie recommender's approach: bge-small embeddings, a taste vector, and a LightGBM ranker that is used **only if it beats the taste vector** on the most recent 20% of your items (needs at least 40 labelled items).
  - Tracking states are the signals:
    - completed / finished / beaten = strong positive
    - drop or DNF before 25% = strong negative; after 75% = mild negative
    - on hold = neutral
    - a rating dominates when present
    - "Not interested" = negative
  - Candidates come from TMDB TV recommendations, Open Library subjects, RAWG discover and game series.
  - Each card shows "Because you liked …", plus Want to read / Watchlist and Not interested buttons.
  - A suggestion opens like any item; its full record is fetched on first open.
- **Taste map:** your items (filled, sized by rating) and suggestions (rings), laid out by the same embeddings (UMAP, or PCA when there are few). Hover for details; every dot links to its page.
- **Imports** (the Import button on the Shows and Books libraries):
  - Goodreads CSV and StoryGraph CSV become books; the **TV rows** of an IMDb ratings export become shows. Films stay with the movie import, which is unchanged.
  - A review screen shows matched / pick one / no match, with manual search.
  - Re-importing creates nothing new.
  - An imported show you rated counts as watched: aired episodes are backfilled on the rated date, then its state derives normally.
  - Imports never invent dates: no start date, and "date added" is never used as a reading date.
- **Settings** (Phase 7): attribution for TMDB, TVmaze (CC BY-SA with link), Open Library, Hardcover, Google Books, RAWG and ntfy is under *Data sources*. That is the doc's "About page"; I put it next to the existing About panel instead of adding a new page.

## Bug found and fixed during the live run
- Book suggestions failed with "database is locked". A job held an open write while the provider cache tried to write from its own session; SQLite allows one writer.
- Fix: jobs commit per step, and cache writes are best-effort, so a busy database can't fail a request.
- A regression test was added.

## Migrations
- One additive table, `mediacandidate`. Rollback: restore the pre-migration snapshot, or drop it.

## Tests
- Backend: **61 passed**. New tests cover:
  - signal weights per state (DNF before 25% / after 75%, on hold, rating dominance, not interested)
  - timeline with exact and year-only dates
  - stats and the all-media rows (and their 404 when every medium is off)
  - show suggestions and the taste map
  - not-interested leaving the slate
  - Goodreads review → commit → no duplicates on re-import
  - StoryGraph DNF without invented dates
  - IMDb TV rows only, backfilled to completed
  - the lock regression
- Frontend: typecheck clean, unit 4/4, visual **7/7**, `npm run build` OK.
- Live on a copy of your data (real providers):
  - Show suggestions: 20 from TMDB.
  - Book suggestions: 24 from Open Library subjects (after the lock fix).
  - All-media stats: 121 films · 270 h alongside shows, books and games.
  - Screenshots of every new page; no console errors.

## Manual checks
1. Books mode → Import → drop your Goodreads export. Review the rows, then Import.
2. Books → Stats → toggle **All media**.
3. Shows → For you → Refresh suggestions. Mark one Not interested and check it disappears.
4. Shows → Taste map: hover the dots, then click one.

## Deviations
- Steam library import skipped (no key).
- The movie recommender and movie stats pages were not changed; All media reads movie data only.
- There is no backend type checker in the project (`pyright` and `mypy` aren't installed), so the backend was verified with the test suite; the frontend with `tsc`. Say if you'd like one added as a dev dependency.

## Open questions
- Phase 9 (cleanup) doesn't apply on the lean path: no dual-write or old tables to remove. The media flags can stay as the on/off switches in Settings.
- The branches are stacked (`phase-1` → … → `phase-8`) and **not merged to `main`**. Merge when you're happy after using it.
