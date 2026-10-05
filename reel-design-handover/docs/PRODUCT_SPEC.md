# Product spec

One user, one machine. The app answers four questions: *what have I watched, when, how much did I like it, and what should I watch next?*

## Core concepts

- **Movie**: a TMDB film cached locally (metadata, credits, keywords, trailer, images, poster palette, embedding).
- **Watch**: one viewing of a movie, with its own date, date precision, rating, rewatch flag, location, company and notes. A movie can have many watches.
- **Watchlist entry**: a movie I intend to watch, with an optional priority.
- **Feedback**: a reaction to a recommendation (`like`, `dislike`, `not_interested`, `opened`, `added_watchlist`, `seen_rated`). This is what the recommender learns from.
- **Rating**: 0.5 to 5.0 in half steps. A film's "my rating" is its most recent watch's rating; the detail page also shows all watches.

## Features

### 1. Search and log (command palette)
- Opens with `Ctrl+K` / `Cmd+K` from anywhere, the sidebar Search button, or any "Log a watch" button. Closes with `Esc`.
- Typing searches TMDB live, debounced 180 ms, minimum 2 characters, up to 8 results. Each row shows the poster thumbnail (36×54), title, year and director.
- Rows carry a local badge where it applies: `Seen N×` if I have N watches, or `On watchlist`.
- `↑/↓` moves the selection and `↵` on a row opens the inline log form for it. If the film has been seen, the Rewatch box starts ticked.
- `Shift+↵` on a row adds it to the watchlist without logging.
- **Log form fields:**
  - **Watched on** (date input; defaults to today).
  - **I remember the** Day / Month / Year (segmented). Month shows a month picker and Year a year picker; the stored date is normalised (see CLAUDE.md).
  - **Rating**: five stars. Clicking star *n* sets *n*, clicking the same star again sets *n − 0.5*, and the keyboard arrows step by 0.5. Rating is optional.
  - **Rewatch** checkbox, **With whom**, **Where**, **Notes**.
- Pressing "Log watch" (`↵` inside the form) saves the watch. The backend fetches full details, images and the palette if they aren't cached yet. The palette closes, a toast confirms "Logged *Title*" with Undo (5 s), and the app navigates to the film's detail page.
- If logging a film that is on the watchlist, it is removed from the watchlist.

### 2. Library
- Header stats: films (distinct), watches, total hours (sum of runtime over all watches).
- **Last watched** card: the most recent watch, glowing in that film's palette.
- Tabs: **Watched** (distinct films with ≥1 watch), **Watchlist**, **Rewatches** (films with ≥2 watches). Counts are shown in the tabs.
- Filters (dropdown chips): Genre (multi), Decade (multi), Rating (minimum my-rating), Director (searchable). Sort: recently watched (default), my rating, release year, title, runtime.
- **Poster wall** (default): a responsive grid. Each card shows the poster, title, my rating, director and last-watched date. Hovering tilts the card in 3D. Clicking opens the detail page.
- **3D carousel**: an optional mode built with react-three-fiber. Posters sit on a slowly rotating cylinder; drag or scroll to spin; click to open. Same data and filters. It honours `prefers-reduced-motion` (no auto-rotate).
- Filter and sort state persists in the URL query string.

### 3. Film detail
- A full-bleed backdrop with the poster, genres, title, year, runtime, director and language.
- Actions: Log a rewatch (or "Log a watch" if unseen), Play trailer (opens a modal with the YouTube embed; needs network), a More menu (Add to / Remove from watchlist, Refresh data, Open on TMDB, Open on IMDb, Delete all my watches…).
- **Your rating** (latest) with the watch count, and **Palette from poster** (5 swatches; hex shown on hover).
- Overview, keywords (chips, up to 8), trailer panel, and cast (top 12 with photo, name and character; initials if there is no photo).
- **Your history**: every watch, newest first, showing date (formatted by precision), precision tag, `first watch` / `rewatch`, rating, where · with whom, and notes. Clicking a watch edits it in the same form as logging; deleting needs confirmation.
- **Scores**: TMDB, IMDb, Rotten Tomatoes and Metacritic (the last three from OMDb when configured; show "–" when missing).
- **Details**: released, director, cinematography, music, data refreshed.
- **Its neighbours on your taste map**: the 6 nearest films by embedding, labelled "Watched · ★ x" or "Suggested · NN%".
- An unseen film opened from recommendations or the taste map uses the same page, minus the history and rating blocks.

### 4. Timeline
- One year at a time (default: the current year), with previous/next buttons. The header shows that year's watch count, how many have approximate dates, and hours.
- **Month strip**: a horizontally scrolling row with a column per month. Each column has the month name, "N films · H h", a tick on the axis line, and the posters in date order with the day and rating under each. Months in the future are dimmed to 35%, and a TODAY marker sits on the current month.
- Month-precision watches appear at the end of their month column with a dashed poster outline and "month" instead of a day. Year-precision watches appear in a final column titled "Sometime in YYYY".
- **Every year**: a bar per year from the first year with data to the current year. Each bar stacks an exact-date segment (solid) under an approximate segment (dashed outline). Clicking a bar jumps the strip to that year.

### 5. Stats
- Range toggle: **All time** / **current year**.
- **KPI tiles**: Films, Hours, Viewing days (distinct day-precision dates), Average rating.
- **Viewing days heatmap**: always the last 53 weeks ending today, Monday-first. The level is the number of films that day (0, 1, 2+). Hovering a cell shows the date and count. Only day-precision watches count.
- **Genres radar**: the top 6 genres by watch count in the range, normalised to the largest.
- **Top directors** and **Top actors**: the top 5 by distinct films watched in the range (actors limited to billing order ≤ 5).
- **Your ratings**: a histogram of 10 half-star bins with counts above the bars and the mean in the header.

### 6. For you (recommendations)
- The header shows the model version, how many ratings and reactions it learned from, and when it last updated.
- Filters: All / Under 2 hours / Wildcards.
- **Top pick**: the highest-scoring candidate, with the poster, "Because you loved X ★ and Y ★" (each linking to its film), up to 4 reason chips (shared director, top shared keywords), and the chance I rate it 4+ (percentage). Actions: Add to watchlist, Seen it (opens the log form), Not interested.
- **Grid**: the next 12 candidates. Each card has the poster, title, meta, score, a "Because you loved…" line, and three icon buttons: Add to watchlist, More like this (`like`), Not interested. Status text appears after a reaction. Not interested dims the card to 40% and it disappears on the next refresh.
- About 10% of slots are **Wildcards**: candidates deliberately far from my taste vector. They have a pink dashed tag and border and the explanation "Far from your usual taste…".
- **Health strip**: the held-out hit rate @20 (current model vs v1), the candidate count and sources, the wildcard share, and a link to the Taste map.
- Recommendations recompute in the background after every 3 new ratings or reactions, and on app start if stale (more than 24 h old).

### 7. Taste map
- A 2D UMAP projection of all cached films (watched, suggested and unseen candidates). Pan by dragging, zoom with the scroll wheel or pinch, and double-click to reset.
- **Watched** films are mini posters sized by my rating (width = 12 + (rating − 3) × 6 px, 2:3 ratio), glowing in their poster colour and labelled with the title.
- **Suggested** films are 16 px accent rings with labels; wildcards are pink. The selected suggestion is filled and pulses.
- **Unseen candidates** are faint 5 px dots, toggled by a checkbox.
- **Cluster labels** are auto-generated (see ARCHITECTURE) and drawn as faint mono uppercase captions.
- Selecting a suggestion draws dashed lines to its 3 nearest highly-rated watched films and fills the side panel: kind, poster, title, meta, score, "Closest films you rated" with cosine similarity bars, a one-line explanation, Add to watchlist, and Back to For you.

### 8. Import
- Settings → Import accepts a **Letterboxd export** (zip, or `diary.csv` + `ratings.csv`) or an **IMDb ratings export** (CSV).
- Rows are matched to TMDB: IMDb rows by `imdb_id` through `/find`; Letterboxd rows by title + year search, taking the top result if its year matches ±1.
- A review table shows each row as matched (with poster), ambiguous (pick from the top 3) or unmatched (search manually or skip). Commit creates watches.
  - Letterboxd diary rows are day precision.
  - Ratings-only rows become a watch with year precision (year of the "Date" column).
  - IMDb ratings are /2, rounded to the nearest 0.5.
- Importing is idempotent: re-importing the same file does not duplicate watches (dedupe on tmdb_id + watched_on + rating + source).

### 9. Onboarding (cold start)
- On first launch with zero watches, the For you page shows a "Rate some films to get started" panel: 20 well-known films from TMDB's popular/top-rated lists, each with the star control and a "Haven't seen it" button. Each rating creates a year-precision watch for the current year, unless I set a date. There is also a link to Import.

### 10. Settings and system
- TMDB token, optional OMDb key, an accent colour (four presets from the design), and the data folder location.
- **Backup**: one click writes `reel-backup-YYYYMMDD.zip` (db + media) to a chosen folder. **Restore** from a zip.
- An About section with the TMDB attribution, also shown in the sidebar footer.

## Non-goals
Multi-user, cloud sync, social features, TV shows, streaming-availability lookups.
