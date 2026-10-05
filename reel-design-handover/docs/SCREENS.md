# Screens

Each screen has a screenshot (`design/screenshots/<Name>-desktop.png`), a static HTML render (`design/static/<Name>.html`) and its source (`design/reference/<Name>.dc.html`). In the source, `{{hole}}` is a data binding, `<sc-for list="{{xs}}" as="x">` is a loop and `<sc-if value="{{c}}">` is a conditional. The `renderVals()` block at the bottom holds the fixture data and the exact state logic (selected styles, star half-fill, heatmap dates). Port that logic; don't reinvent it.

Routes:

| Route | Screen | Reference |
|---|---|---|
| `/` | Library | `Main` |
| `/film/:tmdbId` | Film detail | `Detail` |
| (overlay on any route, `?log=:tmdbId` optional) | Command palette + log form | `Search` |
| `/timeline/:year?` | Timeline | `Timeline` |
| `/stats?range=all\|YYYY` | Stats | `Stats` |
| `/for-you?filter=` | For you | `ForYou` |
| `/map?focus=:tmdbId` | Taste map | `TasteMap` |
| `/settings`, `/import` | Settings / Import (design extension, see the end) | n/a |

---

## Library (`Main`)
**Data:** `GET /library` (+ `/library/facets` for the dropdowns).

1. **Header**: "Library", with the mono subline `{films} films · {watches} watches · {hours} hours` (thousands separator, hours rounded). On the right, a segmented control (Poster wall | 3D carousel) and the primary "Log a watch" button, which opens the palette.
2. **Last watched** card (GlassPanel, padding 22, gap 28, wraps). Contents:
   - An internal glow (520×380 at −80/−120, rgba(glow,.55)).
   - A 96 px poster.
   - An eyebrow `LAST WATCHED · SAT, OCT 3` (mono 12, ls .08em, colour = palette light tinted toward glow; the reference uses `#9FC9B9`).
   - The title (28) and a meta line `Director · Year · 2h 4m · {location}`.
   - On the right, `★ 4.5` (mono 26, palette light) above 4 palette dots (22 px, border `rgba(255,255,255,.2)` on dark swatches).
   - The whole card links to the film. It is hidden when there are no watches.
3. **Toolbar row**: the pill tabs (Watched / Watchlist / Rewatches with counts) on the left; the filter chips (Genre, Decade, Rating, Director, Sort: …) on the right.
4. **Grid**: `repeat(auto-fill, minmax(min(150px,100%),1fr))`, gap 32 / 20. Use infinite scroll with a cursor; load 60 at a time.
   - Watchlist-tab cards show "Added Oct 2" instead of the director·date line, and no rating.
   - **Empty states** (design extension): a centred mono subline, e.g. "Nothing here yet. Press Ctrl K to log your first film.", plus the primary button.
   - **Loading**: skeleton posters (fill `fill-ctl`, radius 12, a 1.2 s opacity pulse).
5. **3D carousel** (design extension, same page): replaces the grid with a react-three-fiber canvas 640 px tall inside a GlassPanel. Posters are planes on a cylinder (radius about 9, 24 per ring). Hovering scales one 1.08; clicking opens the detail. The palette glow of the front-most film tints the scene fog.

## Film detail (`Detail`)
**Data:** `GET /movies/:id`. Palette from `palette[0..1]` → CSS vars `--glow`, `--glow2` on the page root.

1. **Hero** (min-height 600, padding 32 48 44). The backdrop image is cover-positioned behind:
   - two radial glows: glow at 70%, 900×700, at left 30% / top −18%; glow2 at 45%, 700×600, at right −10% / top 10%;
   - a bottom fade over 60% of the height, `linear-gradient(to bottom, transparent, #07080C)`;
   - with an image present, also a `rgba(7,8,12,.35)` overlay so text keeps contrast.

   In the mock, the dashed "BACKDROP · TMDB w1280 · CACHED LOCALLY" label is a placeholder marker. **Do not ship it.**

   - **Top row**: the back pill ("Library", or `history.back()` with the previous page's title).
   - **Bottom row** (wraps, gap 36, aligned to the bottom):
     - the 200 px poster (radius 16, shadow `0 40px 80px -30px glow, 0 0 0 1px rgba(255,255,255,.08)`);
     - an info column: the genre eyebrow in glow, the title (56), the meta (15, `#C3C8D1`), and the actions (gap 10, margin-top 8);
     - a right column: "YOUR RATING" eyebrow, the big rating, "across N watches", then "PALETTE FROM POSTER" with 5 swatches (26 px, radius 8).
2. **Body** (padding 0 48, two columns that wrap, gap 40):
   - **Left** (`flex 1 1 520px`, gap 36):
     - Overview with keyword chips.
     - The trailer panel (16:9, radius 20, a centred 76 px glass play button, caption bottom-left). Clicking opens a modal with a `youtube-nocookie.com` iframe.
     - Cast: a grid `auto-fill minmax(120px,1fr)`, gap 20, with a 72 px circular photo or initials.
   - **Right** (`flex 1 1 340px`, gap 20):
     - **Your history** (glass): an ordered list with a 12 px dot (glow / glow2 / `#8E95A3` cycling, glowing `0 0 14px`) and a 1 px connector line. Each entry shows the date (15 / 500) with the rating, the mono tags, "where · with whom", and the notes.
     - **Scores**: a 2×2 grid.
     - **Details**: a `<dl>`, each row with padding 12 0 and a bottom divider.
3. **Neighbours**: the section title + "Open taste map" link, then a grid `auto-fill minmax(130px,1fr)`, gap 18. Each tile is a poster (radius 12) with the caption "Watched · ★ 4.5" or "Suggested · 87%".

## Command palette + log form (`Search`)
**Data:** `GET /search?q=` (debounced 180 ms), `POST /watches`, `POST /watchlist`.
- Built with `cmdk`, styled per DESIGN_SYSTEM.
- The results list holds up to 8 rows. The selected row (keyboard or click) gets the accent selected style, and the log form appears underneath for it.
- **Empty query state** (design extension): show "RECENT" (the last 5 logged films) and "WATCHLIST" (top 5) groups with the same row style.
- **No results**: the mono line "No matches on TMDB".
- **Errors** (no token or offline): the mono line in `#F0B6DA` with "Open settings".
- Additional commands (cmdk items, shown when the query starts with `>`): Go to Library / Timeline / Stats / For you / Taste map / Settings, Import history, Backup now.
- After a successful save, follow PRODUCT_SPEC §1.

## Timeline (`Timeline`)
**Data:** `GET /timeline?year=` and `GET /timeline/years`.
- **Header**: the year as the title (40), with the subline `{n} watches · {approx} with approximate dates · {hours} hours so far`. ("so far" only for the current year; omit the approx part when it is 0.) Prev/next are 44 px icon buttons.
- **Strip**: `overflow-x: auto`, padding 0 48 12. Each month column has padding-right 28 and min-width 120.
  - The month header shows "N films · H.H h", or "nothing yet" for empty or future months.
  - The axis line is 2 px `line-3` with a 2×14 tick at the column start.
  - Posters are 112 wide with gap 14; under each, the day (mono 12) and ★.
  - Future months are at opacity .35.
  - The TODAY marker (a 10 px accent dot with glow, plus the mono 11 accent label) sits on the current month, offset to the day's proportional position.
  - On load, scroll so the current month is visible at the right.
- **Every year** (GlassPanel, padding 26, margin 0 48): the title + legend, then the year bars. Clicking a bar navigates to `/timeline/:year`.

## Stats (`Stats`)
**Data:** `GET /stats?range=`.
- **Header**: "Stats" + the segmented control All time | {current year}.
- **KPI grid**: `auto-fit minmax(200px,1fr)`, gap 16. The four tiles (eyebrow, value, sub) read:
  - FILMS: `{watches} watches, {rewatched} rewatched`
  - HOURS: `about N days of film` (all time) or `about Xh Ym per film` (year)
  - VIEWING DAYS: `since {first_year}` (all time) or `one film a {week|fortnight|month}` (year; pick by average gap)
  - AVERAGE RATING: `out of 5`
- **Heatmap** panel: title "Viewing days" + `· last 12 months · {n} days`, the legend on the right, and the grid in an `overflow-x: auto` box.
- **Three-panel grid** `auto-fit minmax(320px,1fr)`, gap 16: Genres radar | Top directors + Top actors | Your ratings histogram (with "mean X.X" in the header).

## For you (`ForYou`)
**Data:** `GET /recommendations?filter=` and `POST /feedback`.
- **Header**: "For you", with the subline `ranked by model {v} · learned from {n} ratings + {m} reactions · updated {relative}`. Segmented: All | Under 2 hours | Wildcards.
- **Top pick** (hero GlassPanel). It has a glow from the film's glow colour (the reference uses `rgba(94,160,150,.32)`, 760×560 at right −120 / top −200), a 190 px poster, and an info column:
  - eyebrow "TOP PICK TONIGHT" in `--color-score`
  - the title (44) and meta
  - the "Because you loved" line, with film names as white underlined links and mono ★ ratings
  - the reason chips
  - the actions
  On the right: "CHANCE YOU RATE IT 4+" above the big percentage.
- **Grid** `auto-fill minmax(340px,1fr)`, gap 16, of rec cards (padding 18, gap 18, a 92 px poster). Each card holds:
  - the WILDCARD tag (if any)
  - the title with the score on the right (mono 14)
  - the meta (13 `#A3A9B6`) and the reason (14 `#D5D9E0`)
  - the action row, pushed to the bottom (margin-top auto): bookmark, thumbs-up (toggle, accent when on), not-interested (toggle; the card dims to .4), and status text on the right (12 `#8E95A3`): "Noted: more like this" / "Hidden, model notified".
- **Health strip** (outline panel, padding 20 24, gap 32): three label/value pairs and the "See why on the taste map" button on the right.
- **Cold start**: when there are fewer than 10 ratings, replace the top pick and grid with the onboarding panel (design extension): a glass panel titled "Rate a few films to get started", with a grid of poster + StarRating + "Haven't seen it" text button, and an "Import from Letterboxd or IMDb" secondary button.

## Taste map (`TasteMap`)
**Data:** `GET /tastemap` and `GET /tastemap/explain/:id`.
- **Header**: "Taste map", with the subline `UMAP of {n} film embeddings · overview + keywords + genres`. On the right, the legend items plus the "unseen candidates" checkbox (a 44 px label hit area).
- **Body**: the map (`flex 999 1 520px`, 700 tall) and the side panel (`flex 1 1 280px`, glass, radius 24, padding 24, gap 18). The default selection is the top recommendation.
- **Map**: points are positioned with `left: x%; top: y%` inside a transformed inner layer for pan/zoom. Labels counter-scale so they stay at 11–12 px. Zoom runs 1–6×; neighbour lines sit in an SVG overlay with `viewBox 0 0 100 100`, `preserveAspectRatio="none"` and `vector-effect: non-scaling-stroke`.
- **Interactions**:
  - Click a suggestion ring to select it (the panel updates).
  - Click a watched poster to open the detail.
  - Hover any point for a tooltip "Title · ★ 4.5" or "Title · 84%".
  - `/map?focus=:id` centres and selects that film.
- **Side panel**: the kind eyebrow (accent or wildcard colour), a 64 px poster with the title / meta / "84% chance of 4+", then "Closest films you rated" (bar list with "cos 0.81"), the note, and the actions pinned to the bottom (primary Add to watchlist; outline "Back to For you").

## Design extensions (not in the mockups; build them in the same vocabulary)
- **Settings** (`/settings`): page header + glass panels. The panels are:
  - API keys (password inputs with Save; show "Connected" mono text in `--color-score` after a test call)
  - Accent (4 swatch buttons, 44 px, the selected one with a 2 px white ring)
  - Data folder
  - Backup / Restore
  - About (TMDB attribution + logo per their guidelines)
  Reach it from a 44 px gear icon button at the bottom of the sidebar, above the attribution, and from the palette's `>` commands.
- **Import** (`/import`): a drop zone (a dashed `line-5` panel, radius 22, 200 tall), then the review table. Each row has a status tag (`matched` / `pick one` / `no match`), the poster thumbnail, the raw title·year, the matched film and an include checkbox. A sticky footer shows the summary and the "Import N watches" primary button.
- **Toasts**: a glass pill bottom-centre with radius 14, padding 12 16, 14 px, an optional "Undo" text button in accent, and a 5 s timeout.
- **Trailer modal**: a scrim like the palette, then a 16:9 frame, max 1100 wide, radius 20, with a close icon button.
- **Edit watch**: the same form as the log form, in a centred dialog with the same styling, plus a "Delete watch" text button in `#F0B6DA` that asks for confirmation.

List every extension you build in your phase summary so it can be reviewed against the design later.
