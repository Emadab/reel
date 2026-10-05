# Build plan

Work in order. Each phase ends with the checks listed under it, then a short written summary covering what was built, deviations from the design, and any design extensions added. Don't start a phase until the previous one passes.

## Phase 0: Scaffold (½ day)
- [ ] Create the repo layout from CLAUDE.md. Copy `docs/` and `design/` in unchanged.
- [ ] Backend: a `uv` project, FastAPI app with `/api/health`, settings from `.env` (`TMDB_TOKEN`, `OMDB_KEY`, `DATA_DIR`), SQLite engine, and pytest set up.
- [ ] Frontend: Vite + React + TS strict, Tailwind v4 with `design/theme.css` copied to `src/theme.css`, the fontsource packages, React Router, TanStack Query, and `/api` + `/media` proxied to :8000.
- [ ] A `Makefile` with `dev`, `test` and `typecheck` targets.
- [ ] Fixture mode (`VITE_FIXTURES=1`) wired into the API layer, loading `design/fixtures/sample-data.json`, with a frozen clock of 2026-10-05.
- [ ] Playwright set up with a `test:visual` script that screenshots routes at 1440×900 in fixture mode and compares against `design/screenshots/`. Library, Detail and Search are compared at full page; the overlay is opened with the palette in the state shown.

**Done when:** `make dev` serves both; `/api/health` returns ok; a blank themed page renders in Geist on `#07080C`.

## Phase 1: Backend backbone (1–2 days)
- [ ] Models and migrations (ARCHITECTURE §1).
- [ ] The TMDB client with caching, rate limiting and the `/configuration` image base; OMDb client.
- [ ] `media.py`: image download and palette extraction (ARCHITECTURE §4).
- [ ] Endpoints: `/search`, `/movies/{id}`, `/movies/{id}/refresh`, `/watches` CRUD, `/watchlist`, `/library` (+facets).
- [ ] Date normalisation by precision; hours and counts helpers.
- [ ] Tests with mocked TMDB (respx) for search, detail fetch, logging a watch (which caches the movie, downloads images and removes it from the watchlist), date precision and library filters.

**Done when:** you can search, add, log, list and filter entirely via Swagger at `/docs`; tests pass.

## Phase 2: Core UI (2–3 days)
- [ ] Shell: Sidebar (active states, Ctrl/⌘K), page transition wrapper and toasts.
- [ ] Components: GlassPanel, Button variants, Segmented, PillTabs, FilterChip + popover, TagChip, MonoTag, Badge, Poster + PosterArt, StarRating, inputs, Icons.
- [ ] Command palette + log form, complete with keyboard behaviour.
- [ ] Library page (poster wall, tabs, filters, sort, infinite scroll, last-watched card).
- [ ] Film detail page (hero, history, scores, details, cast, trailer modal, edit/delete watch). Leave neighbours as a placeholder until phase 5.
- [ ] Watchlist tab.

**Done when:**
- Visual tests for Library, Detail and Search pass in fixture mode.
- The real app can log a film end to end against TMDB.
- The keyboard alone can open the palette, search, log with a rating and land on detail.

## Phase 3: Futuristic layer + history views (2 days)
- [ ] Palette-driven theming everywhere (CSS vars per film; Library glow from the last watched).
- [ ] Framer Motion route transitions and the shared-element poster → detail.
- [ ] Timeline page + `/timeline` endpoints (including month/year-precision placement).
- [ ] Stats page + `/stats` endpoint; all chart components.
- [ ] 3D carousel mode.
- [ ] Responsive rules (DESIGN_SYSTEM: icon rail, bottom tab bar).
- [ ] Reduced-motion support.

**Done when:**
- Visual tests for Timeline and Stats pass.
- The Stats numbers match a hand-computed check on the fixture data (unit test).
- The layout holds at 390, 768 and 1440 widths with no horizontal page scroll (except inside the Timeline strip and heatmap boxes).

## Phase 4: Import + recommender v1 (2–3 days)
- [ ] Letterboxd and IMDb importers with the review UI (`/import`). Verify column names against a real export before relying on them.
- [ ] Onboarding panel (cold start).
- [ ] Embeddings (background job), candidate generation, the v1 ranker with MMR, because/reasons, and the wildcard slots.
- [ ] The `/recommendations` endpoint and For you page (top pick, grid, filters, health strip with the v1 baseline).
- [ ] Neighbours on the detail page.

**Done when:**
- Importing a 300-row Letterboxd export takes under 2 minutes, excluding first-time image downloads, which continue in the background.
- For you shows 13 sensible recs with explanations.
- The visual test for For you passes in fixture mode.

## Phase 5: Learning + taste map (2 days)
- [ ] Feedback endpoint and the card buttons (optimistic UI).
- [ ] The v2 ranker (logistic → LightGBM), retrain triggers, model versioning and the evaluation harness (`hit_at_20` vs baseline).
- [ ] The UMAP projection, HDBSCAN cluster labels and the `/tastemap` + explain endpoints.
- [ ] Taste map page (pan/zoom, selection, neighbour lines, side panel, candidates toggle, focus param).

**Done when:**
- The visual test for the Taste map passes.
- The evaluation runs on startup with a real history and is shown in the health strip.
- Feedback changes the next slate (test: not_interested removes the film; like raises similar films' scores).

## Phase 6: Packaging + safety (1–2 days)
- [ ] Settings page (keys, accent, data dir) and the accent applied app-wide.
- [ ] Backup/restore zip.
- [ ] Tauri v2 shell with the FastAPI sidecar (PyInstaller or `uv`-bundled), serving the built frontend; window title "Reel"; data dir in the OS app-data folder. Fallback: pywebview.
- [ ] First-run flow: ask for the TMDB token and validate it with `/configuration`.
- [ ] Optional: recommender v3 (MovieLens ALS feature + candidate source).

**Done when:** a double-clickable app starts offline (cached data visible), backs up to a zip, and restores from it on a clean profile.
