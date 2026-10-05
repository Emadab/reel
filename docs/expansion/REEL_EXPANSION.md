# Reel expansion plan: TV series, books and games

Instructions for Claude Code. Put this file at `docs/expansion/REEL_EXPANSION.md` in the Reel repo.

---

## How to use this file (for the human)

1. Copy this file into the repo at `docs/expansion/REEL_EXPANSION.md` and commit it.
2. Add the snippet in **Appendix A** to the repo's `CLAUDE.md` (create it if missing).
3. Start Claude Code in the repo, switch to plan mode, and paste the **kickoff prompt** (Appendix B).
4. Run **one phase per session**. At each phase gate, review the report, try the app yourself, then start the next phase with the **phase prompt** (Appendix B).
5. Never skip Phase 0 or Phase 1. They are what keeps Reel safe.

---

## 1. Context and goal

Reel is an existing, working, local movie-tracking app. The owner loves it as it is. The goal is to extend it to track **TV series** (with Trakt-like new-episode announcements), **books** and **games**, each with tracking states that make sense for that medium, while disturbing the existing movie experience as little as possible.

The target design is summarized in section 5 (core concepts) and the appendices. Where Reel's existing stack, names or structure differ from this plan, **adapt the plan to Reel, not Reel to the plan**. The concepts matter; the exact names do not.

## 2. Ground rules (non-negotiable)

1. **Movies must keep working at every commit.** Every existing movie flow (search, add, log a watch, rate, watchlist, posters, stats, recommendations, whatever exists) must behave exactly as before unless a phase explicitly changes it and the human approved it.
2. **Expand, then contract.** Add new structures alongside old ones. Migrate data with idempotent scripts. Switch reads only behind a flag. Delete legacy structures only in Phase 9.
3. **Migrations are additive until Phase 9.** No `DROP`, no destructive `ALTER`, no renaming existing columns or tables before then.
4. **Back up before any migration.** Run the backup script (created in Phase 1) before applying a migration, every time.
5. **Feature flags gate all new media and the new read path.** New media are invisible until their flag is on.
6. **Preserve the look and feel.** Reuse Reel's existing design tokens, components, fonts, colours and motion. New views must look like they were always part of Reel. Do not restyle existing pages.
7. **Small, reviewable commits.** One logical change per commit, with a clear message. Work on a branch per phase: `expansion/phase-N-<name>`.
8. **Tests first for anything you refactor.** Characterization tests must exist before existing code is touched.
9. **External APIs are called only from the backend.** Never from the frontend. Keys live in `.env`, never committed.
10. **Respect every provider's rate limits and terms**, including during bulk imports and backfills. Add attribution where required.
11. **Ask before adding heavy dependencies** or changing the build, packaging or runtime model.
12. **Stop at every phase gate.** Write the phase report (section 4) and wait for the human. Do not start the next phase on your own.
13. **When the plan conflicts with reality, stop and ask.** Do not silently work around it.

## 3. Feature flags

Create a single flags module (or reuse Reel's settings system if it has one) with these flags, all default `false` unless stated:

| Flag | Turns on |
| --- | --- |
| `core.dual_write` | Movie writes also go to the new tables (Phase 2) |
| `core.v2_reads` | Movie reads come from the new tables (Phase 2) |
| `media.shows` | TV series everywhere in the UI and API (Phase 4) |
| `announcements` | Scheduler jobs and notifications (Phase 5) |
| `media.books` | Books (Phase 6) |
| `media.games` | Games (Phase 7) |

Flags are readable by the frontend through one settings endpoint. Turning a flag off must fully hide its feature without errors.

## 4. Phase report format

At the end of every phase, write `docs/expansion/phase-N-report.md` containing:

- What was done, as a list of commits.
- Migrations added and how to roll each back.
- Test results: existing tests, characterization tests, new tests (counts, all passing).
- The manual check list for the human (concrete clicks to try in the app).
- Deviations from this plan and why.
- Open questions for the human.

---

## 5. Core concepts (target design)

### 5.1 Items, library, runs, events

- **Item:** anything trackable, with a `kind`: `movie`, `show`, `book`, `game`. Shared fields live in one place; kind-specific fields live in a `details` JSON column, promoted to real columns only when they must be filtered or sorted.
- **External IDs:** one item can carry many provider IDs (TMDB, IMDb, TVmaze, Open Library, ISBN-13, Hardcover, IGDB, Steam, RAWG). Unique on `(source, ext_id)`, which is what prevents duplicates.
- **Library entry:** one per item. Your relationship with it outside of consuming it: `shelf` (`wishlist`, `backlog`, `not_interested`, or null), ownership, platforms or formats, priority.
- **Run:** one pass through an item (a viewing, a series watch-through, a read-through, a playthrough). Has its own status, start and finish dates with precision, progress, rating, review, and variant (platform, edition, format). A rewatch, reread or replay is a **new run**; earlier runs are never overwritten.
- **Event:** an append-only log of everything that happened (episode watched, progress update, play session, status change, rating). The timeline and stats read from runs and events.
- **Displayed status** = active run's status, else latest run's status, else the shelf.

### 5.2 Target schema (adapt names and types to Reel's ORM)

```sql
items         (id PK, kind, title, original_title, year, release_date, overview, tagline,
               genres JSON, tags JSON, cover_path, backdrop_path, palette JSON,
               status,          -- released | upcoming | returning | ended | canceled
               endless BOOL,    -- games without an ending
               details JSON, embedding BLOB, refreshed_at, created_at)
external_ids  (item_id FK, source, ext_id, PRIMARY KEY (source, ext_id))
people        (id PK, name, photo_path, external_ids JSON)
item_people   (item_id FK, person_id FK, role, character, ord)
seasons       (id PK, item_id FK, number, name, premiere_date, episode_count, poster_path)
episodes      (id PK, item_id FK, season, number, title, overview, airstamp_utc,
               runtime_min, still_path, is_special BOOL, provider_ids JSON)
library       (item_id PK FK, shelf, owned BOOL, platforms JSON, formats JSON, priority, added_at)
runs          (id PK, item_id FK, run_no, status, status_source,  -- user | derived
               started_on, finished_on, date_precision,          -- day | month | year | unknown
               progress JSON, goal, variant JSON, rating, review, updated_at)
events        (id PK, item_id FK, run_id FK NULL, episode_id FK NULL, kind,
               occurred_at, date_precision, payload JSON)
follows       (id PK, target_kind, target_id, notify BOOL, created_at)
notifications (id PK, item_id, episode_id, type, payload JSON, dedupe_key UNIQUE,
               created_at, seen_at, delivered_desktop_at, delivered_push_at)
http_cache    (key PK, url, status, etag, body BLOB, fetched_at, ttl_s)
sync_state    (provider, job, last_run_at, cursor JSON)
```

Keep Reel's existing rating scale everywhere. Do not change it.

### 5.3 Tracking states per medium

**Shelves (shared):** `wishlist` (labelled Watchlist for movies and shows, Want to read for books, Wishlist for games), `backlog` (books and games: owned, not started), `not_interested` (hidden from suggestions, negative signal).

**Movies**

| State | Meaning | Set by |
| --- | --- | --- |
| `in_progress` | Started, stopped partway, intend to finish | User |
| `watched` | Finished | User |
| `abandoned` | Stopped, will not finish | User |

**TV series**

| State | Meaning | Set by |
| --- | --- | --- |
| `watching` | Aired episodes remain unwatched | Derived, on first episode tick |
| `caught_up` | All aired episodes watched; show returning or between seasons | Derived |
| `completed` | Show ended or canceled and all episodes watched | Derived |
| `on_hold` | Paused deliberately | User |
| `dropped` | Stopped for good | User |

A new episode airing moves `caught_up` to `watching`. A revived show moves `completed` to `caught_up`. Specials (season 0) never count toward state.

**Books**

| State | Meaning | Set by |
| --- | --- | --- |
| `reading` | Actively reading | User |
| `paused` | Set aside, intend to return | User |
| `finished` | Read to the end | User, or derived at 100% progress |
| `did_not_finish` | Stopped for good; progress kept | User |
| `dipping` | Reading non-linearly with no plan to finish | User |

**Games**

| State | Meaning | Set by |
| --- | --- | --- |
| `playing` | Actively playing | User, or derived when Steam playtime increases |
| `shelved` | Paused, intend to return | User |
| `beaten` | Credits reached or main story done | User |
| `completed` | Run goal beyond the credits reached (100%, all achievements) | User, or derived from achievements |
| `abandoned` | Quit for good | User |
| `retired` | Stopped playing an endless game | User |

Game runs carry a `goal`: `main`, `main_extras`, `completionist`. Items flagged `endless` skip `beaten` and `completed`.

**Transition table** (implement exactly once, in one service; every status change goes through it and is logged as a `status_change` event; invalid transitions return HTTP 409 with the allowed next states):

```python
TRANSITIONS = {
    "movie": {None: {"in_progress", "watched", "abandoned"},
              "in_progress": {"watched", "abandoned"}},
    "show":  {None: {"watching"},
              "watching": {"caught_up", "completed", "on_hold", "dropped"},
              "caught_up": {"watching", "completed", "dropped"},
              "completed": {"caught_up"},
              "on_hold": {"watching", "dropped"}, "dropped": {"watching"}},
    "book":  {None: {"reading", "finished", "dipping"},
              "reading": {"paused", "finished", "did_not_finish"},
              "paused": {"reading", "did_not_finish"}, "dipping": {"reading", "finished"},
              "did_not_finish": {"reading"}},
    "game":  {None: {"playing", "beaten", "completed"},
              "playing": {"shelved", "beaten", "completed", "abandoned", "retired"},
              "shelved": {"playing", "abandoned"}, "beaten": {"playing", "completed"},
              "abandoned": {"playing"}},
}
STICKY = {"on_hold", "dropped", "paused", "did_not_finish", "shelved", "abandoned", "retired"}
```

Rules:

- **Sticky states win.** Automated jobs may set derived states but must never overwrite a sticky one.
- **Prompt, don't guess.** After 6 weeks without activity on a `watching` show or `playing` game, suggest on hold or shelved in the UI; never change it automatically.
- **Backfilled history** may start directly in a final state (transition from `None`).
- **Partial dates** are first-class: "sometime in 2019" is stored as `2019-01-01` with precision `year`.

**Progress JSON shapes**

| Kind | Shape |
| --- | --- |
| Movie | `{"minute": 54}` (optional) |
| Show | `{"watched": 18, "aired": 24}` (derived, cached) |
| Book | `{"unit": "page" or "percent" or "minutes", "current": 212, "total": 480}` |
| Game | `{"hours": 31.5, "percent": 64}` |

### 5.4 Provider interface

```python
class Provider(Protocol):
    name: str
    kinds: set[Kind]
    async def search(self, q: str, kind: Kind) -> list[SearchHit]: ...
    async def fetch(self, ext_id: str, kind: Kind) -> ItemData: ...
    async def changed_since(self, since: datetime) -> set[str]: ...  # empty set if unsupported
```

`SearchHit` and `ItemData` are normalized dataclasses; nothing outside `providers/` sees raw provider JSON.

Shared HTTP layer for all providers: one async client per provider with a descriptive User-Agent including a contact email; a token-bucket limiter per provider set just under its limit; retries with exponential backoff and jitter on 429 and 5xx honouring `Retry-After` (max 4 attempts); a response cache with ETag revalidation; coalescing of identical in-flight requests.

### 5.5 Data sources

| Source | Media | Use | Auth | Limit (respect it) |
| --- | --- | --- | --- | --- |
| TMDB | Movies, TV | Canonical metadata, images, recommendations, release dates | Existing Reel key | Cache everything |
| TVmaze | TV | Exact air times, episodes, update feed (`/updates/shows?since=day|week|month`), lookup by IMDb ID | None | At least 20 calls per 10 s per IP; keep one connection; CC BY-SA attribution with link |
| Open Library | Books | Works, editions, authors, covers by ISBN | None; User-Agent with email | 1 req/s, 3 req/s when identified |
| Hardcover | Books | Series, release dates | Personal token | 60 req/min; beta API; server-side only |
| Google Books | Books | Fallback descriptions and page counts | API key | About 1,000 req/day |
| IGDB | Games | Canonical metadata, covers, release dates, time to beat | Twitch client ID and secret | 4 req/s; server-side only |
| RAWG | Games | Fallback metadata, screenshots | API key | 20,000 req/month; hyperlink attribution |
| Steam Web API | Games | Owned games, playtime, achievements | API key + public profile | Light use |

Joins: shows TMDB to TVmaze through the IMDb ID; books by Open Library work key, then ISBN-13, then title plus author; games by IGDB ID, Steam app IDs through IGDB external games data.

Do not use TheTVDB (paid user subscription) or Trakt (restricted for free accounts) as data sources.

---

## 6. Phases

Each phase lists deliverables, acceptance criteria and its gate. A gate always also requires: **all pre-existing tests and all characterization tests pass, and the phase report is written.**

### Phase 0: Audit (read-only)

Make **no code changes** in this phase except creating documentation.

Produce `docs/expansion/AUDIT.md` covering:

- Stack and versions (backend, frontend, database, ORM, migrations tool, build, packaging, how the app is started).
- The complete current database schema, with row counts from the live database if available.
- Every movie flow end to end: route, service, database writes, UI component.
- The TMDB client: where it lives, caching, error handling, image download and storage paths.
- Frontend structure: routing, state management, design tokens, shared components, how posters and palettes are rendered.
- Existing tests and how to run them; current pass rate.
- Recommender: what exists, what data it reads.
- A **mapping table** from every concept in section 5 to existing Reel code or tables ("exists as X", "partially exists", "new").
- Risks specific to this codebase, and any part of this plan that does not fit Reel, with a proposed adaptation.
- A proposed adjusted version of Phases 1 to 9 if needed.

**Gate:** the human approves `AUDIT.md` and any adaptations.

### Phase 1: Safety net

Deliverables:

- A backup script (`scripts/backup.*`) that snapshots the database (SQLite online backup if SQLite) and image folders into `backups/<timestamp>/`, plus a restore script. Document both in the README.
- **Characterization tests** that pin current movie behaviour: every movie API endpoint (request, response shape and key values), the database effects of add, log watch, rate, edit, delete, watchlist, and any computed views (stats, recommendations input). Use a fixed test database seeded from a sanitized copy of the real data or realistic fixtures. Mock TMDB with recorded fixtures.
- If the frontend has no end-to-end tests, add a minimal Playwright smoke test: open app, search a movie (mocked), add it, log a watch, see it in the library.
- The feature flags module from section 3, all flags off, plus a settings endpoint exposing them.

Acceptance: characterization tests pass on unmodified code; backup and restore round-trip verified on a copy of the database.

### Phase 2: Generalize the core (expand and contract)

Do these as separate commits, in order:

1. **2a. Additive migration:** create the section 5.2 tables (only those needed now: `items`, `external_ids`, `people`, `item_people`, `library`, `runs`, `events`). Do not touch existing tables.
2. **2b. Backfill script:** idempotent, re-runnable, transactional. Map existing data, for example:
   - each movie row to an `items` row with `kind='movie'`, plus `external_ids` for TMDB and IMDb;
   - each watch or diary entry to a `runs` row (`status='watched'`, `run_no` ordered by date, existing rating and notes) plus a matching `events` row;
   - watchlist entries to `library.shelf='wishlist'`;
   - existing image paths copied as-is into `cover_path` and `backdrop_path` (do **not** move image files).
   Adapt these mappings to the real schema found in Phase 0. The script ends with a verification report: counts per old table versus new table, and a sample of 20 random movies compared field by field.
3. **2c. Dual-write:** behind `core.dual_write`, every movie write path also writes the new tables in the same transaction. Tests prove both stay consistent.
4. **2d. Shadow-read comparison:** a test (and an optional debug endpoint) that computes every movie read from both the old and the new tables and asserts identical results.
5. **2e. Switch reads:** behind `core.v2_reads`, movie reads come from the new tables. Run the full characterization suite with the flag on and off.
6. **2f. Status machine:** implement the transition service from section 5.3 and route movie status changes through it. Movies use `watched` (and optionally `in_progress`, `abandoned` if the UI gains them; ask first).

Acceptance: with both flags on, the characterization suite passes unchanged and the app is indistinguishable for movies. The human uses the app for a few days with flags on before Phase 3.

### Phase 3: Provider layer

Deliverables:

- The shared HTTP layer from section 5.4 (`core/http`), with `http_cache` and per-provider limiters.
- Wrap Reel's existing TMDB client as the first `Provider` **without changing its observable behaviour**. Movie search and fetch go through it.
- A normalized `SearchHit` and `ItemData`, and a search fan-out service that takes `kinds` and returns local library hits first, then provider results.
- An image store service that keeps existing image paths valid and saves new images under `images/<kind>/<hash>.<ext>` with a thumbnail, extracting a colour palette if Reel already uses palettes (reuse its method).

Acceptance: movie characterization tests pass; provider tests with recorded fixtures (for example `respx` or the stack's equivalent); a rate-limit test proves the limiter holds.

### Phase 4: TV series (flag `media.shows`)

Deliverables:

- Migration: `seasons`, `episodes`.
- Providers: TMDB TV (metadata, images, seasons, episodes, external IDs, recommendations) and TVmaze (episodes with `airstamp`, update feed, lookup by IMDb ID). Store air times in UTC.
- Show state derivation: computes `watching`, `caught_up`, `completed` from episode events, aired episodes and show status; never overrides sticky states.
- API: show detail with seasons and episodes, mark episodes watched (single, list, whole season), unmark, up-next endpoint.
- UI, in Reel's existing style: medium filter chips (Movies, Shows) in library and search; show detail page with season tabs and an episode grid (tick to watch, dimmed unaired episodes, mark season watched); an up-next row on the home screen with progress rings; show states in the status control.
- Search palette returns shows with a type badge when the flag is on.

Acceptance: with `media.shows` off, the app is identical to before. With it on: add a show, tick episodes, see the state move through watching, caught up and completed correctly (unit tests cover each derivation, including specials, revivals and sticky states).

### Phase 5: Announcements (flag `announcements`)

Deliverables:

- Migration: `follows`, `notifications`, `sync_state`.
- In-process scheduler with these jobs: show updates every 6 hours and at startup (TVmaze update feed for the window since the last run, then refetch changed followed shows and diff); air-time alerts every 15 minutes for high-priority shows; movie digital releases daily (TMDB release dates for watchlisted films).
- Diff engine producing notifications with `dedupe_key` values such as `episode:<id>:aired`, `season:<show>:<n>:announced`, `movie:<id>:digital_release`. Same-day episodes of one show collapse into one notification. Sticky runs get no alerts.
- Delivery: in-app notification centre and a calendar view; desktop notifications; optional phone push via an ntfy topic configured in settings; quiet hours with a digest afterwards.
- Startup catch-up using `sync_state.last_run_at`.
- If the app does not already autostart, propose (do not implement without approval) a way to run the backend in the background on login.

Acceptance: jobs are idempotent (running twice creates no duplicates; tested); diff tests cover new season, date moved, episode aired, renewal, cancellation; notifications open the right item.

### Phase 6: Books (flag `media.books`)

Deliverables:

- Providers: Open Library (canonical work key, covers by ISBN), Hardcover (series, release dates), Google Books (fallback). Identify to Open Library with a User-Agent containing a contact email from settings.
- Book states and progress (pages, percent or audio minutes) through the transition service; `finished` derived at 100% unless the run is sticky.
- UI: book detail page, progress update control, shelf view, currently-reading strip on home.
- Announcements: weekly job for followed authors and series (new book announced, release date passed).

Acceptance: as for Phase 4, including state transition tests and an import-free manual flow (search, add to backlog, start reading, update progress, finish, rate, reread as a second run).

### Phase 7: Games (flag `media.games`)

Deliverables:

- Providers: IGDB (Twitch OAuth client credentials with automatic token refresh, 4 req/s limiter), RAWG fallback, Steam Web API (owned games, playtime, achievements).
- Game states, goals, `endless` flag, time-to-beat estimates from IGDB.
- Steam sync job every 2 hours while running: playtime becomes session events; a started game moves to `playing` unless its run is sticky.
- UI: game detail page with platform, goal, hours and estimate of time left; backlog planner sorting backlog books and games by estimated time left.
- Announcements: wishlisted game releases and date changes; new DLC or expansions for games you have beaten.

Acceptance: as above, plus a test that Steam playtime never overrides `abandoned`, `shelved` or `retired`.

### Phase 8: Cross-media features and imports

Deliverables:

- Timeline and stats aggregate all enabled media with filter chips: finish counts per medium (watched, completed shows, finished books, beaten or completed games), hours watched and played, pages read, drop and DNF rates.
- Recommender: keep Reel's movie recommender working; add per-medium models using the same approach; feed tracking-state signals (completed to 100% and binges are strong positives; drops and DNFs before 25% progress are strong negatives, after 75% mild negatives; on hold is neutral). Evaluate on held-out recent items and only replace a model if metrics improve.
- Imports with a review screen and no duplicates: IMDb (shows), Goodreads and StoryGraph CSV (books), Steam library (games: 0 hours to backlog, others to a review screen).
- An About page listing every provider's attribution.

### Phase 9: Cleanup (only after the human confirms two weeks of daily use without regressions)

- Remove the dual-write path and old movie tables in a final migration, after a backup.
- Remove `core.*` flags; keep media flags if the human wants them as settings.
- Update README and `CLAUDE.md`.

---

## Appendix A: snippet for the repo's CLAUDE.md

```markdown
## Expansion work (TV, books, games)

- The plan is in docs/expansion/REEL_EXPANSION.md. Read it fully before any expansion work.
- Work only on the phase you were asked for. Stop at its gate and write the phase report.
- Movies must keep working at every commit. Run the characterization tests before every commit.
- Migrations are additive until Phase 9. Run scripts/backup before applying any migration.
- New media stay behind their feature flags.
- Reuse Reel's existing design system and components; do not restyle existing pages.
- External APIs only from the backend; keys only in .env.
- If the plan conflicts with the code, stop and ask.
```

## Appendix B: prompts to paste into Claude Code

**Kickoff prompt (Phase 0):**

```
Read docs/expansion/REEL_EXPANSION.md completely, then read CLAUDE.md.
Do Phase 0 only: audit the Reel codebase and write docs/expansion/AUDIT.md
exactly as the plan describes, including the concept mapping table and any
adaptations the plan needs to fit this codebase. Make no code changes.
When done, summarize the riskiest findings and the questions you need me to answer.
```

**Phase prompt (Phases 1 to 9):**

```
Read docs/expansion/REEL_EXPANSION.md, docs/expansion/AUDIT.md and the
previous phase reports in docs/expansion/. Start Phase N on a new branch
expansion/phase-N-<name>. First show me your plan for this phase as a list of
commits, then wait for my approval. Follow the ground rules strictly. At the
end, run all tests, write docs/expansion/phase-N-report.md and stop.
```

**Recovery prompt (if something breaks):**

```
Something in the movie experience changed: <describe what you saw>.
Stop feature work. Reproduce it with a failing characterization test first,
then fix it with the smallest possible change, and explain the root cause.
```