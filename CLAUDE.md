# Reel: personal movie tracker

A local-first, single-user desktop app for logging the films I watch, seeing my history visualised, and getting recommendations that learn from my ratings. It runs on my own machine, needs no account, and keeps all its state in one SQLite file plus a folder of cached images.

"Reel" is a working name. It appears only in the sidebar wordmark and the window title.

## Read these before writing code

| File | What it decides |
|---|---|
| `docs/PRODUCT_SPEC.md` | What every feature does, including edge cases |
| `docs/ARCHITECTURE.md` | Backend modules, data model, API contract, TMDB/OMDb usage, recommender |
| `docs/DESIGN_SYSTEM.md` | Tokens, type, components, motion, accessibility. **Exact values** |
| `docs/SCREENS.md` | Each screen: layout, components, data bindings, states |
| `docs/BUILD_PLAN.md` | Phased tasks with acceptance criteria. Work through it in order |
| `design/screenshots/*.png` | What each screen must look like at 1440 px wide |
| `design/static/*.html` | The same screens as plain HTML/CSS. Open in a browser and inspect for exact values |
| `design/reference/*.dc.html` | The design source (template + data). Data arrays here are the fixture data |
| `design/theme.css` | Drop-in Tailwind v4 theme + base styles. Use it as-is |
| `design/icons.tsx` | Every icon in the design, as React components |
| `design/fixtures/sample-data.json` | Fixture data that reproduces the screenshots |

## Stack (fixed)

- **Backend:** Python 3.12, FastAPI, SQLModel (SQLite), httpx (async), Pydantic v2, `uv` for env/deps, pytest.
- **Frontend:** React 19 + Vite + TypeScript (strict), Tailwind CSS v4, TanStack Query for server state, React Router, Framer Motion, react-three-fiber + drei (3D carousel only), `cmdk` for the command palette.
- **Charts:** hand-built SVG components (heatmap, radar, bar lists, histogram, year bars). Do **not** pull in Recharts/visx; the designs are simple and must match exactly.
- **ML:** sentence-transformers (`BAAI/bge-small-en-v1.5`), scikit-learn, LightGBM, umap-learn, implicit (optional v3), colorthief.
- **Packaging (last phase):** Tauri v2 with the Python backend as a sidecar. If sidecar bundling becomes a time sink, fall back to pywebview.

## Repo layout

```
reel/
├── CLAUDE.md
├── docs/  design/                 # this handover, committed as-is
├── backend/
│   ├── pyproject.toml
│   ├── app/
│   │   ├── main.py                # FastAPI app, routers mounted under /api
│   │   ├── config.py              # settings from .env
│   │   ├── db.py                  # engine, session, migrations-on-startup
│   │   ├── models.py              # SQLModel tables
│   │   ├── schemas.py             # API response/request models
│   │   ├── tmdb.py  omdb.py       # API clients + caching
│   │   ├── media.py               # image download, palette extraction
│   │   ├── importers.py           # Letterboxd / IMDb CSV
│   │   ├── routers/               # search, movies, watches, watchlist, library, timeline, stats, recs, tastemap, imports, system
│   │   └── recommender/
│   │       ├── features.py  candidates.py  ranker.py  tastemap.py  evaluate.py
│   ├── data/                      # movies.db, media/, models/  (gitignored)
│   └── tests/
└── frontend/
    ├── src/
    │   ├── theme.css              # copied from design/theme.css
    │   ├── components/            # Sidebar, Poster, PosterArt, GlassPanel, Segmented, Chip, StarRating, ...
    │   ├── components/charts/     # Heatmap, Radar, BarList, RatingHistogram, YearBars
    │   ├── features/search/       # CommandPalette + LogWatchForm
    │   ├── pages/                 # Library, FilmDetail, Timeline, Stats, ForYou, TasteMap
    │   ├── api/                   # typed client + TanStack Query hooks
    │   └── lib/                   # formatters (runtime, dates with precision), color utils
    └── e2e/                       # Playwright visual tests against design/screenshots
```

## Commands

- `cd backend && uv run fastapi dev app/main.py` serves the API on :8000 (Swagger at /docs)
- `cd backend && uv run pytest`
- `cd frontend && npm run dev` serves the UI on :5173 and proxies `/api` and `/media` to :8000
- `cd frontend && npm run test:visual` runs the Playwright screenshot comparison in fixture mode
- `make dev` runs both (write this Makefile in phase 1)

## Rules

### Design fidelity is a requirement, not a goal
1. The screenshots and `design/static/*.html` are the source of truth. When a doc and a screenshot disagree, the screenshot wins; flag the conflict in your summary.
2. Copy numeric values exactly (px, radii, opacities, letter-spacing, gaps). Never round to the Tailwind scale. Use the tokens in `theme.css`; where no token exists, use an arbitrary value (`gap-[28px]`, `rounded-[22px]`).
3. Fonts are Unbounded (display), Geist (UI) and Geist Mono (numbers, eyebrows). Self-host them with `@fontsource/unbounded`, `@fontsource/geist`, `@fontsource/geist-mono`. The app must work offline.
4. Do not add UI that isn't in the designs or specs (no extra stats, badges, tooltips, onboarding tours, empty-state illustrations). If something seems missing, build it in the existing visual vocabulary and list it in your summary as a design extension.
5. No emoji anywhere in the UI. Icons come from `design/icons.tsx` only.
6. Every interactive element is a real `<button>`, `<a>` or `<input>` with a label; icon-only buttons get `aria-label`; hit targets are at least 44 px.

### Fixture mode
The frontend must support `VITE_FIXTURES=1`. In that mode the API layer returns `design/fixtures/sample-data.json` instead of calling the backend, and "today" is frozen at 2026-10-05. Visual tests run in fixture mode at 1440×900 and compare against `design/screenshots/`. Keep fixture mode working through every phase.

### Backend
- The TMDB token lives only in `backend/.env` (`TMDB_TOKEN`). It never reaches the frontend or the logs.
- Every TMDB/OMDb response is cached in SQLite. A movie is refetched only when `fetched_at` is older than 30 days, or when the user presses Refresh on the detail page.
- Images are downloaded once into `data/media/` and served from `/media/...`. The UI never hot-links `image.tmdb.org`.
- Dates are stored as ISO `YYYY-MM-DD` plus `date_precision` (`day|month|year`). Month precision stores the 1st of the month; year precision stores Jan 1. Never display the padded day for imprecise dates.
- Schema changes go through small, idempotent migrations in `db.py`. Never drop user data.

### Working style
- Work phase by phase from `docs/BUILD_PLAN.md`. At the end of each phase: all tests pass, the visual test passes for the screens built so far, and you write a short summary of what changed and any deviations.
- Prefer small, typed, well-named modules over clever abstractions. Type-check (`tsc --noEmit`, `pyright` or `mypy`) before declaring done.
- Ask before adding a dependency that isn't listed above.

## Expansion work (TV, books, games)

- The plan is in docs/expansion/REEL_EXPANSION.md. Read it fully before any expansion work.
- Work only on the phase you were asked for. Stop at its gate and write the phase report.
- Movies must keep working at every commit. Run the characterization tests before every commit.
- Migrations are additive until Phase 9. Run scripts/backup before applying any migration.
- New media stay behind their feature flags.
- Reuse Reel's existing design system and components; do not restyle existing pages.
- External APIs only from the backend; keys only in .env.
- If the plan conflicts with the code, stop and ask.
