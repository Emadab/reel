# Phase 3 report: provider layer

Branch `expansion/phase-3-providers` (stacked on phase 1).

## Commits
- `f268374` Add the shared provider HTTP layer with SQLite cache, limiter, retries and coalescing
- `4e29621` Add TMDB TV, TVmaze, Open Library, Google Books, Hardcover and RAWG providers

## What exists now
- `app/providers/http.py`: one `Client` per provider.
  - Requests are spaced just under each provider's limit.
  - 429 and 5xx responses are retried up to 4 times, with backoff and jitter, honouring `Retry-After`.
  - Responses are cached in the `httpcache` table with a per-row TTL and ETag revalidation.
  - Identical in-flight requests are coalesced.
  - When offline (the existing `net.py` breaker), a stale cached copy is served instead of failing.
  - Each provider sends its own User-Agent. It includes `CONTACT_EMAIL` only if you set it.
- `app/providers/base.py`: `SearchHit`, `ItemData` (with seasons, episodes, people and recommendations), and the `Provider` protocol.
- Providers:

  | Provider | Covers | Notes |
  | --- | --- | --- |
  | `tmdb_tv` | shows | Reuses the movie client's auth and retry; `app/tmdb.py` is unchanged |
  | `tvmaze` | show airstamps (UTC), status, update feed | |
  | `openlibrary` | books | Canonical; also author works |
  | `googlebooks` | books | Fallback |
  | `hardcover` | book series, release dates | |
  | `rawg` | games | Canonical |

  `PRIMARY` maps each medium to its canonical provider.
- `media.store_image(kind, url)` saves to `media/<kind>/<sha1>.<ext>`, and `media.palette_for` reuses the poster palette method.

## Migrations
- One additive table, `httpcache`. Rollback: restore the automatic `pre-migration` snapshot, or `DROP TABLE httpcache` (it is only a cache).

## Tests
- Backend: **32 passed**. The 10 new provider tests cover the limiter, cache/TTL/ETag, retries, coalescing, stale-on-offline, and each provider's normalisation.
- One full-suite run had a single failure that 13 later runs did not reproduce. It is being watched (see open questions).

## Deviations
- **IGDB is not used.** You couldn't set up Twitch two-factor auth, so RAWG is the canonical games source. RAWG has no per-goal time-to-beat (main / extras / completionist), only one average `playtime`, so time-left estimates use that average.
- Movie search and fetch do **not** go through the new layer. That is the lean path: movie code stays untouched.
- The search fan-out (local hits first, then providers) needs the item tables, so it moved to Phase 4.
- No image thumbnails. Covers are fetched at medium size.

## Open questions
- One unreproduced intermittent failure in the full suite. If it shows up again, I'll pin it down before going further.
