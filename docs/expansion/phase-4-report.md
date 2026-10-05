# Phase 4 report: TV series (and the shared media core)

Branch `expansion/phase-4-shows`, stacked on phase 3.

The UI is built around **workspace modes**, the Zen-style switcher you asked for. Book and game tracking used the same tables, status service and pages, so their core pieces landed here too. Phases 6 and 7 add what is specific to each.

## Commits
- `5a0c831` Characterization: drain background jobs before reads. This fixes the intermittent failure from phase 3: a recompute race in the test, not in the app.
- `1563761` Item, library, run, event, season and episode tables, and the status transition service
- `70ba3cd` Item ingest, show state derivation, book progress and game hours services
- `ce11027` Flag-gated media API with show, book and game state tests
- `bd7d497` Search thumbnails served locally, backlog planner, cached-only opens, cleaner Open Library data
- `5093fdd` Workspace modes: per-medium sidebar, accent cross-fade, Ctrl 1–4 switching
- `f2b2e10` Show, book and game library and detail pages, and the media search palette

## What you get with `media.shows` on
- **Mode switcher** at the bottom of the sidebar, with Movies, Shows, Books and Games icons; `Ctrl 1–4` switches too.
  - It appears only when at least one media flag is on.
  - In a mode, Library, search (`Ctrl K`) and the pages show only that medium.
  - The accent cross-fades per mode: movies keep your accent, shows are violet, books amber, games lime.
  - Movie routes and pages are untouched.
- **Shows library:**
  - An Up next rail with progress rings and a one-click "mark watched" for the next aired episode.
  - Tabs: Watching / Up to date / Watchlist / Completed / On hold / Dropped.
  - Genre and sort chips.
- **Show page:**
  - The film-page hero (backdrop, palette glows, poster).
  - "Watched S1 · E4" as the primary action.
  - A status menu that offers only the states you set yourself (on hold, dropped, resume), because the other states are derived from episodes.
  - Season tabs with an episode grid. Tick to watch; shift-click marks everything up to that episode; unaired episodes are dimmed; "Mark season watched".
  - Your run (rating), your history (rewatches as runs), details with TMDB / IMDb / TVmaze links.
  - After six weeks without activity it suggests putting the show on hold, and never changes the state on its own.
- **State derivation:** watching → up to date → completed from aired regular episodes and the show's status.
  - Specials never count.
  - A newly aired episode moves "up to date" back to watching.
  - A revival moves completed back to up to date.
  - On hold and dropped are never overwritten.
- **Data:** TMDB TV supplies metadata, seasons and recommendations; TVmaze supplies exact UTC airstamps, looked up by IMDb id.
  - Every image, including search thumbnails and episode stills, is downloaded once into `data/media/`.
  - The thumbnail endpoint only fetches from the three image CDNs (TMDB, Open Library, RAWG).

## Migrations
- Additive tables: `item`, `externalid`, `person`, `itemperson`, `season`, `episode`, `libraryentry`, `run`, `event`.
- `migrate()` took an automatic `pre-migration` snapshot when these were created. Verified on a copy of your real database.
- Rollback: `scripts/restore.py <that snapshot>`, or drop the nine new tables. No existing table was altered.

## Tests
- Backend: **44 passed**.
  - 12 new media tests: the transition table and its 409s, flags hiding everything, watching → up to date → newly aired → watching, completed → revival → up to date, season ticks, sticky on-hold surviving ticks and re-derivation, the inactivity suggestion, search marking library items without duplicates, the book flow (backlog → reading → progress → derived finished → rating → reread as run 2), a paused book not finishing at 100%, game hours / goal / time left, and an endless game whose sticky states survive logged hours.
  - The movie golden test is unchanged and passed every run.
- Frontend: typecheck clean, unit tests 4/4, visual tests **7/7** (movie screens unchanged with flags off).
- Live run on a **copy** of your data (temp `DATA_DIR`, flags on), driven with Playwright, no console errors:
  - Searched and opened Severance, started watching, shift-ticked E01–E03.
  - The Up next rail showed E04 with 3/19.
  - Opened Piranesi, started reading, saved page 120, saw the Currently reading strip.

## Manual checks
1. `scripts/backup.py`, then start Reel. Settings → Media flags (this toggle arrives in Phase 8). Until then: `curl -X PUT localhost:8000/api/settings -H "Content-Type: application/json" -d "{\"flags\":{\"media.shows\":true}}"`
2. Press `Ctrl 2`. Search a show, open it, press Start watching, tick a few episodes, then shift-click a later one.
3. Back on Shows, tick the Up next card. Put the show on hold, tick an episode, and check it stays on hold.
4. Press `Ctrl 1`. Movies are exactly as before.

## Deviations
- Book and game services and pages arrived early, because they share everything with shows.
- Unticking an episode deletes that tick's event rather than appending an "unwatched" event: it undoes a mistake, not a fact.
- No mode switcher on phone widths (<640 px). It is a desktop app; ask if you want one.
- New icons (film, TV, book, game, bell, calendar) were added to `components/Icons.tsx` in the same stroke style. They are design extensions.
- The "cyberpunk" brief is met with Reel's existing neon vocabulary: per-mode accent glow, HUD-style mono eyebrow, accent underline on the active mode. Existing pages were not restyled.

## Open questions
- Should a show you mark completed by hand (watching → completed is allowed by the doc's table) stay completed even when episodes remain? Today the derivation moves it back to watching on the next change, so the UI doesn't offer it.
