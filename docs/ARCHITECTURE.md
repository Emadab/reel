# Architecture

```
React (Vite)  ──/api──▶  FastAPI  ──▶  SQLite (data/movies.db)
     │                      │──▶  TMDB API (httpx, cached)
     └──/media──▶ static     │──▶  OMDb API (optional, cached)
                 data/media/ └──▶  recommender (in-process, background tasks)
```

Everything runs locally. FastAPI serves `/api/*` and mounts `data/media/` at `/media`. In packaged builds it also serves the built frontend.

## 1. Data model (SQLModel)

```python
class Movie(SQLModel, table=True):
    tmdb_id: int = Field(primary_key=True)
    imdb_id: str | None = Field(index=True)
    title: str
    original_title: str | None
    year: int | None
    release_date: date | None
    runtime: int | None              # minutes
    overview: str | None
    tagline: str | None
    genres: list[str] = Field(sa_column=Column(JSON))
    director: str | None             # comma-joined if several
    directors: list[dict] = JSON     # [{id, name}]
    crew_highlights: dict = JSON     # {cinematography: [...], music: [...], writer: [...]}
    cast: list[dict] = JSON          # [{id, name, character, order, profile_path}] top 20
    keywords: list[str] = JSON
    language: str | None             # ISO 639-1
    poster_path: str | None          # TMDB path, e.g. "/abc.jpg"
    backdrop_path: str | None
    trailer_key: str | None          # YouTube key
    palette: list[str] = JSON        # 5 hex colours, ordered: [glow, glow2, dark, light, ink]  (see §4)
    tmdb_rating: float | None
    tmdb_votes: int | None
    popularity: float | None
    omdb: dict | None = JSON         # {imdb: "8.0", rt: "88%", metacritic: "81"}
    fetched_at: datetime
    omdb_fetched_at: datetime | None
    embedding: bytes | None          # float32[384], L2-normalised
    umap_x: float | None
    umap_y: float | None

class Watch(SQLModel, table=True):
    id: int | None = Field(primary_key=True)
    tmdb_id: int = Field(foreign_key="movie.tmdb_id", index=True)
    watched_on: date = Field(index=True)   # normalised by precision
    date_precision: Literal["day", "month", "year"] = "day"
    rating: float | None                    # 0.5..5.0 step 0.5
    is_rewatch: bool = False
    location: str | None
    with_whom: str | None
    notes: str | None
    source: Literal["manual", "letterboxd", "imdb", "onboarding"] = "manual"
    created_at: datetime

class WatchlistItem(SQLModel, table=True):
    tmdb_id: int = Field(primary_key=True, foreign_key="movie.tmdb_id")
    added_at: datetime
    priority: int = 0

class Feedback(SQLModel, table=True):
    id: int | None = Field(primary_key=True)
    tmdb_id: int = Field(index=True)
    signal: Literal["like", "dislike", "not_interested", "opened", "added_watchlist", "seen_rated"]
    created_at: datetime

class Candidate(SQLModel, table=True):      # current recommendation slate
    tmdb_id: int = Field(primary_key=True)
    sources: list[str] = JSON               # ["tmdb_recs:603", "discover:genre:878", "movielens"]
    score: float                            # P(rating >= 4)
    is_wildcard: bool = False
    because: list[int] = JSON               # up to 2 tmdb_ids of watched films
    reasons: list[str] = JSON               # chips, e.g. "same director as Stalker", "space station"
    rank: int
    model_version: str
    computed_at: datetime

class Setting(SQLModel, table=True):        # key/value
    key: str = Field(primary_key=True)
    value: str

class ImportJob(SQLModel, table=True):      # staged import rows awaiting review
    id: int | None = Field(primary_key=True)
    source: str
    created_at: datetime
    rows: list[dict] = JSON                 # [{raw, status, tmdb_id, options:[...], include: bool}]
```

Derived values (never stored): my rating = the latest watch's rating; is_seen; watch count; hours = Σ runtime over watches.

## 2. TMDB and OMDb integration

Auth: `Authorization: Bearer {TMDB_TOKEN}` (the v4 "API Read Access Token"). Base: `https://api.themoviedb.org/3`.

| Need | Call |
|---|---|
| Live search | `GET /search/movie?query=…&include_adult=false&page=1` |
| Full details (one call) | `GET /movie/{id}?append_to_response=credits,keywords,videos,release_dates,external_ids` |
| Candidates | `GET /movie/{id}/recommendations`, `GET /movie/{id}/similar`, `GET /discover/movie?with_genres=…&with_keywords=…&with_crew=…&sort_by=vote_average.desc&vote_count.gte=200` |
| Onboarding | `GET /movie/top_rated`, `GET /movie/popular` |
| Map IMDb → TMDB | `GET /find/{imdb_id}?external_source=imdb_id` |
| Image base and sizes | `GET /configuration` (cache 7 days) |

- **Director**: `credits.crew` where `job == "Director"`. Cinematography: `job == "Director of Photography"`. Music: `job == "Original Music Composer"`.
- **Trailer**: from `videos.results`, take `site == "YouTube"`; prefer `type == "Trailer"` and `official == true`, then the most recent.
- **Images** (`media.py`): download the poster at `w500` (plus `w185` for thumbnails), the backdrop at `w1280`, and cast profiles at `w185`, into `data/media/{poster|poster_sm|backdrop|profile}/{tmdb_id or person_id}.jpg`. Do it lazily on first need, then permanently. If an image is missing, the UI shows `PosterArt` (see DESIGN_SYSTEM) using the palette or a hash-derived colour.
- **Rate limiting**: an async semaphore (max 8 concurrent) plus retry with backoff on 429/5xx.
- **OMDb** (optional `OMDB_KEY`): `GET https://www.omdbapi.com/?i={imdb_id}&apikey=…`. Parse `imdbRating`, `Ratings[] where Source=="Rotten Tomatoes"`, and `Metascore`. Cache 30 days. The free tier is limited per day, so fetch only on detail-page open, never in bulk.
- **Freshness**: refetch when `fetched_at` is older than 30 days, or on explicit refresh.
- Search results are cached in memory for 10 minutes, keyed by the query string.

## 3. API contract

All JSON, prefixed `/api`. Use Pydantic response models; the frontend types are generated from `/openapi.json` with `openapi-typescript`.

Shared shapes:

```ts
type DatePrecision = "day" | "month" | "year";
type FilmCard = { tmdb_id: number; title: string; year: number|null; director: string|null;
  runtime: number|null; poster: string|null /* "/media/poster/603.jpg" */; poster_sm: string|null;
  palette: string[]; my_rating: number|null; watch_count: number; on_watchlist: boolean;
  last_watched: { date: string; precision: DatePrecision } | null };
type WatchOut = { id: number; tmdb_id: number; watched_on: string; date_precision: DatePrecision;
  rating: number|null; is_rewatch: boolean; location: string|null; with_whom: string|null; notes: string|null };
```

| Method & path | Purpose / response |
|---|---|
| `GET /search?q=` | `{results: [{tmdb_id, title, year, director, poster_sm, watch_count, on_watchlist}], took_ms}`. Fetch the director lazily (details cache) for the top 8 only |
| `GET /movies/{id}` | Full detail: FilmCard + overview, genres, keywords, cast, crew_highlights, language, release_date, backdrop, trailer_key, scores `{tmdb, imdb, rt, metacritic}`, `watches: WatchOut[]`, `neighbors: [{FilmCard, kind: "watched"|"suggested", score?}]`, fetched_at |
| `POST /movies/{id}/refresh` | Refetch from TMDB (+OMDb) |
| `POST /watches` | Body: `{tmdb_id, watched_on, date_precision, rating?, is_rewatch?, location?, with_whom?, notes?}` → WatchOut. Ensures the movie is cached and removes it from the watchlist |
| `PATCH /watches/{id}` / `DELETE /watches/{id}` | Edit or delete |
| `GET /library?tab=watched\|watchlist\|rewatches&genre=&decade=&min_rating=&director=&sort=&cursor=` | `{counts: {watched, watchlist, rewatches}, totals: {films, watches, hours}, last_watched: FilmCard & {watch: WatchOut}, items: FilmCard[], next_cursor}` |
| `GET /library/facets` | Genres, decades and directors available for the filter dropdowns |
| `GET/POST/DELETE /watchlist[/{id}]` | Manage the watchlist |
| `GET /timeline?year=` | `{year, totals: {watches, approx, hours}, months: [{month: 1..12, films: [FilmCard & {watch: WatchOut}], approx: [...]}], year_only: [...]}` |
| `GET /timeline/years` | `[{year, total, approx}]` |
| `GET /stats?range=all\|YYYY` | `{kpis: {films, watches, rewatched, hours, viewing_days, first_year, avg_rating}, heatmap: [{date, count}] /*last 371 days*/, genres: [{name, value /*0..1*/, count}], directors: [{name, count}], actors: [{name, count}], ratings: [{bin: 0.5..5, count}], mean}` |
| `GET /recommendations?filter=all\|short\|wild` | `{model: {version, ratings_used, reactions_used, computed_at}, top: Rec, items: Rec[], health: {hit_at_20, baseline_hit_at_20, holdout_n, candidate_count, sources: string[], wildcard_share}}` where `Rec = FilmCard & {score, is_wildcard, because: FilmCard[], reasons: string[], overview}` |
| `POST /feedback` | `{tmdb_id, signal}` |
| `POST /recommendations/recompute` | Run in the background; returns 202 |
| `GET /tastemap` | `{points: [{tmdb_id, x, y, kind: "watched"\|"suggested"\|"candidate", title, rating?, color, is_wildcard?}], clusters: [{label, x, y}], bounds}`. x and y are normalised to 0..1 |
| `GET /tastemap/explain/{id}` | `{film: Rec, nearest: [{FilmCard, similarity}], note}` |
| `POST /import/{letterboxd\|imdb}` | multipart → `{job_id, summary: {matched, ambiguous, unmatched}}` |
| `GET /import/{job_id}` / `PATCH /import/{job_id}/rows/{i}` / `POST /import/{job_id}/commit` | Review and commit |
| `GET /onboarding` | 20 films to rate |
| `GET/PUT /settings` | Accent, data dir, key presence (never return key values) |
| `POST /system/backup` / `POST /system/restore` | Zip of db + media |

Date formatting (shared helper in `frontend/src/lib/dates.ts`):
- `day`: "Oct 3" this year, "Nov 21, 2025" otherwise; the long form is "Sat, Oct 3".
- `month`: "March 2020".
- `year`: "Sometime in 2019".

## 4. Poster palette

On first fetch, run colorthief `get_palette(color_count=8, quality=5)` on the `w185` poster. Convert to OKLCH and choose:

1. `glow`: the swatch with the highest chroma where 0.55 ≤ L ≤ 0.85. If none qualifies, take the highest-chroma swatch and clamp L into that range.
2. `glow2`: the next swatch whose hue differs from glow by more than 40°, with the same L clamp. Fall back to glow rotated +150° hue at 0.6 L.
3. `dark`: the lowest-L swatch with L clamped to ≤ 0.25.
4. `light`: the highest-L swatch with L clamped to ≥ 0.85.
5. `ink`: `#0A0E12`-ish; use the darkest swatch at L 0.12.

Text placed on `glow` (the detail primary button) uses `#120904` if WCAG contrast ≥ 4.5, otherwise `#FFFFFF`. `PosterArt` fallback: background = dark (or glow for light posters), foreground = whichever of light/dark contrasts better.

## 5. Recommender

### Features (`features.py`)
- **Text embedding**: `bge-small-en-v1.5` on `"{title}. {genres}. {keywords}. {overview}"`, normalised to 384-d. Compute in a background task after fetch, in batches of 32 on CPU.
- **Structured**: decade one-hot, log runtime, language (top 10 + other), genre multi-hot, director id hash (for overlap), and top-5 cast ids.

### Candidate generation (`candidates.py`)
For my 15 highest-rated watches from the last 2 years (fall back to all-time), take TMDB `recommendations` + `similar` (page 1). Add `discover` queries for my top 3 genres, top 10 keywords (by rating-weighted frequency) and top 5 directors. Optionally (v3) add MovieLens ALS neighbours. Remove anything seen, on the watchlist, or marked not_interested. Target 300–500 candidates and fetch details for any not cached.

### v1: no training (`ranker.py`)
- My mean rating is μ. The taste vector is t = Σ wᵢ · eᵢ, where wᵢ = (ratingᵢ − μ) · exp(−age_daysᵢ / 730). Unrated watches get w = 0.15 · decay.
- Score = cos(t, e_c) + 0.05 · director_overlap + 0.03 · cast_overlap.
- Re-rank with MMR (λ = 0.7, similarity = cosine of embeddings), then limit to 2 films per director in the top 13.
- `because`: the 1–2 watched films rated ≥ 4 with the highest cosine to the candidate. `reasons`: shared director, then the top 3 shared keywords.
- Display score: a logistic calibration of the cosine onto P(≥4), using a Platt fit on my own ratings once there are ≥ 30.

### v2: learned (once there are ≥ 50 ratings + feedback)
- Label = 1 if rating ≥ 4 or feedback ∈ {like, added_watchlist}; 0 if rating ≤ 2.5 or feedback ∈ {dislike, not_interested}. Drop ambiguous rows.
- Features: the v1 cosine, cosine to my top-20 centroid, structured features, TMDB rating and popularity (log), and decade distance to my median decade.
- Start with logistic regression and switch to LightGBM (`num_leaves=15, n_estimators=200, learning_rate=0.05`) once there are ≥ 150 labels. Retrain in seconds on startup and after every 3 new labels. Store the model in `data/models/` with a version string `v2-YYYYMMDD-HHMM`.

### Wildcards
Reserve `round(0.1 · N)` slots for candidates in the bottom quartile of v1 cosine but with TMDB rating ≥ 7.3 and votes ≥ 500. Pick them randomly, seeded by date so the slate is stable for a day.

### Evaluation (`evaluate.py`)
Hold out my 10 most recent watches. Retrain on the rest, generate candidates, and count how many held-out films land in the top 20 (= `hit_at_20`). Run the same for v1 (= baseline). Run this after each retrain and store the result.

### v3 (optional)
MovieLens `ml-latest-small` or `ml-32m` `links.csv` maps `movieId → tmdbId`. Train implicit ALS offline once (positives = rating ≥ 4) and store the item factors. Then use the cosine to my ALS profile as one extra feature and add ALS neighbours as a candidate source. Optionally add a CLIP/DINOv2 backdrop embedding as a "visual style" feature.

## 6. Taste map (`tastemap.py`)
- Run UMAP (`n_neighbors=15, min_dist=0.1, metric="cosine", random_state=42`) over the embeddings of all cached films. Recompute when the film count grows by more than 10% (nightly at most), and place new films in between using `umap.transform`.
- Normalise to 0..1 with a 4% margin.
- **Clusters**: HDBSCAN on the 2D points (min_cluster_size = 8). Label each cluster with its 2 most over-represented keywords/genres versus the global set (TF-IDF), formatted as "WORD & WORD" in uppercase. Labels are placed at the cluster centroid, offset to the cluster's emptiest edge. The user can rename a label (stored in Setting).
- Explanation note templates:
  - Between two clusters: "Sits between your {A} films and your {B} ones…"
  - Same director as a watched film: "Same director as your highest-rated …"
  - Wildcard: "A wildcard: deliberately far from everything you rate highly…"

## 7. Background work
Use FastAPI `BackgroundTasks` plus a single in-process asyncio worker queue for: image downloads, palette extraction, embeddings, candidate refresh, retraining and UMAP. Every job is idempotent. `GET /system/jobs` shows progress (used by the import review screen).

## 8. Testing
- **Backend**: pytest with `respx` to mock TMDB. Fixture JSON for 3 films lives in `tests/fixtures/tmdb/`. Cover date normalisation, import matching, the stats maths (hours, viewing days, histogram bins) and the recommender determinism (seeded).
- **Frontend**: Vitest for formatters and colour utils; Playwright visual tests in fixture mode (`maxDiffPixelRatio: 0.02`).
