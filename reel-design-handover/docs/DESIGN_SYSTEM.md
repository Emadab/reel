# Design system

**Direction:** dark "projection room". The base is a near-black, cool `#07080C`. Panels are frosted glass (white at 4% fill, 9% border, 24 px backdrop blur). The single UI accent is ice cyan `#7FDBFF`, which the user can change. Each film brings its **own poster palette**, which tints that film's glows, its primary button and its rating colour. Display type is the wide, geometric Unbounded; the UI is set in Geist; every number, date, eyebrow and kbd uses Geist Mono.

Tokens live in `design/theme.css`. The values below are exact. Where a value is listed here and not in the theme, use an arbitrary Tailwind value.

## Typography

| Role | Font | Size / weight | Extra |
|---|---|---|---|
| Page title (Library, Stats…) | Unbounded | 40 / 600 | letter-spacing −0.01em |
| Film title (detail hero) | Unbounded | 56 / 600 | lh 1.02, ls −0.02em, `text-wrap: balance` |
| Top-pick title | Unbounded | 44 / 600 | lh 1.05 |
| Last-watched title | Unbounded | 28 / 600 | |
| Section title | Unbounded | 18 / 500 | |
| Month label (timeline) | Unbounded | 20 / 500 | |
| KPI value | Unbounded | 40 / 500 | lh 1 |
| Big rating (detail) | Unbounded | 64 / 500 | lh 1, colour = film glow |
| Top-pick % | Unbounded | 56 / 500 | colour `--color-score` |
| Score value (detail) | Unbounded | 24 / 500 | |
| Rec card title | Unbounded | 17 / 500 | lh 1.2 |
| Map side panel title | Unbounded | 20 / 500 | lh 1.15 |
| Wordmark | Unbounded | 17 / 600 | ls 0.02em |
| Poster-art title | Unbounded | 15 / 600 (wall), 20–22 (large), 11–13 (small) | lh 1.1–1.15 |
| Body | Geist | 14 (UI), 15 (meta), 16 (overview, lh 1.65, max 64ch), 17 (top-pick "because", lh 1.5) | |
| Small | Geist | 13 (meta), 12 (captions) | |
| Header subline | Geist Mono | 13 | colour `#9AA1AE` |
| Eyebrow | Geist Mono | 11–12, uppercase | ls 0.08–0.12em |
| Ratings `★ 4.5` | Geist Mono | 12 (cards), 14 (history), 26 (last watched) | colour `#E6E1C8` or film light colour |
| kbd | Geist Mono | 11 | 1 px `line-5` border, radius 5–6, padding 1–3 × 6–7 |

Always print ratings with one decimal ("5.0", "4.5"). Use `★` (U+2605), not an icon.

## Colour usage
- **Text** uses ink tokens only, never series or palette colours. The exceptions are the film-glow items listed below and the score colours.
- **Film palette** (`palette[0]` = glow, `[1]` = glow2) drives:
  - the detail hero radial glows, at 70% and 45% mix
  - the detail genre eyebrow, the big rating, ★ in the history list, the timeline dot, and the primary "Log a rewatch" button with its glow shadow `0 10px 30px -10px glow`
  - the last-watched card glow, at `rgba(glow, .55)` inside the card and `.42` for the page glow
  - the poster shadow on every poster: `0 22px 44px -22px {poster bg}`
- **Accent** is used for:
  - the primary buttons (Log a watch, Add to watchlist; text `#07080C`)
  - the active-nav dot and the logo ring
  - focus rings, chart fills, the selected search row (`rgba(127,219,255,.08)` bg + `color-mix(in oklch, accent 55%, transparent)` border)
  - map rings and lines, and the TODAY marker
- **Heatmap levels**: empty `rgba(255,255,255,.05)`, 1 film `color-mix(in oklch, accent 55%, #07080C)`, 2+ films = accent.
- **Year bars**: the selected year uses accent; others use `color-mix(in oklch, accent 45%, #07080C)` for the fill and a 55% mix for the dashed approx outline.
- **Wildcard**: `#F0B6DA` for the tag (1 px dashed), the score, the map ring and the card border at 35% alpha.

## Layout shell
- The root is a flex row (`flex-wrap: wrap`), at least 100vh tall, on bg `#07080C`, with `overflow: hidden` for the glows.
- **Sidebar**: `flex: 1 1 220px` (renders at 220 wide), padding 28 / 18, vertical gap 28, right border `line-nav`. It is not sticky in the mock; in the app make it `position: sticky; top: 0; height: 100vh` on ≥ 1024 px.
  1. Logo row (padding 0 10, gap 10): a 26×26 ring (radius 8, 1.5 px accent border) with an 8 px accent dot glowing `0 0 12px accent`, plus the wordmark.
  2. Search button: 44 tall, radius 12, fill `fill-ctl`, border `line-1`, padding 0 12, gap 10, text `#A3A9B6` 14 "Search" + kbd "Ctrl K" (show "⌘K" on macOS).
  3. Nav list (gap 4). Each item is 44 tall, radius 12, padding 0 12, gap 12, a 18 px icon and 14 px text, `#A3A9B6`, hover fill `fill-ctl`. The active item has fill `fill-nav-active`, text `#FFF` weight 500, and a 6 px accent dot on the right. Items: Library, Timeline, Stats, For you, Taste map.
  4. Footer (pushed down with `margin-top: auto`): TMDB attribution, 11 px, lh 1.5, `#8E95A3`, padding 0 10.
- **Main**: `flex: 999 1 560px; min-width: 0`, padding 36 48 64. The vertical gap between sections is 32 on Library, 28 on Stats and For you, 24 on Taste map, and 36 on Timeline. Timeline's main has no horizontal padding, because the strip bleeds; its children add 48 px themselves.
- **Page header**: a flex row that wraps, items aligned to the bottom (flex-end), with space-between and a 20 gap. On the left, the title over a mono subline (gap 8). On the right, the controls.
- **Ambient glow**: an absolute radial gradient `radial-gradient(closest-side, rgba(c,.42), transparent)`, 980×680, positioned at top −320 / right −180, with no pointer events. Library uses the last-watched film's glow colour.

### Responsive rules (the mocks are desktop only; implement these)
- At ≥ 1024 px the layout is as designed.
- Between 640 and 1023 px:
  - The sidebar collapses to a 72 px icon rail (no labels, no attribution) and the Search button becomes an icon button.
  - Main padding becomes 28 / 24.
  - Two-column areas stack.
- Below 640 px:
  - The sidebar becomes a bottom tab bar (5 icons + labels, 64 tall, glass) with Search as a floating 56 px accent button.
  - Main padding becomes 20 / 16 / 96, and page titles drop to 30.
  - The poster grid is 2 columns (`minmax(0,1fr)`) with gap 20 / 12.
  - The detail hero poster is 120 wide and the title 34.
  - The palette dialog goes full-screen.

## Components

### GlassPanel
Radius 22, fill `fill-glass`, 1 px `line-2` border, `backdrop-filter: blur(24px)`, padding 24 (22 for the last-watched card, 26 for Every year). Variants:
- `card`: rec cards, fill `fill-card`, border `line-1`, padding 18
- `tile`: KPI tiles, radius 20, padding 22
- `outline`: no fill, details list and health strip
- `hero`: top pick, radius 26, padding 28, border `line-3`

### Buttons
- **Primary**: height 44 (46 in the detail hero), padding 0 18–20, radius 14, accent background, text `#07080C` 14 / 600, with an optional leading 16 px icon (stroke 2.2) and gap 8.
- **Secondary**: same size, fill `fill-ctl` (`rgba(255,255,255,.08)` in hero), 1 px `line-5` border, text `#ECEEF3` 14 / 400. Hover fill `rgba(255,255,255,.1)`.
- **Icon button**: 44×44 (46 in hero), radius 12 (14 in hero), 1 px `line-4` border, transparent; the icon is 18 px. Pressed or "on" state: accent background and border, with the icon `#07080C`.
- **Back pill** (detail): height 44, padding 0 16 0 12, radius 12, bg `rgba(7,8,12,.45)`, border `line-4`, blur 16.

### Segmented control
The outer is padding 4, gap 4, radius 14, fill `fill-ctl`, border `line-1`. Each item is height 36, padding 0 14–16, radius 10, 13 px. Active: fill `fill-seg-active` with text `#FFF`. Inactive: transparent with `#A3A9B6`. In the log form the active item is a light pill (`#ECEEF3` with `#07080C` text) and the outer uses `fill-input`; the item height there is 34.

### Pill tabs (Library collection)
Height 40, padding 0 16, radius 999, 14 px, followed by a count in mono 12 at 70% opacity. Active: bg and border `#ECEEF3`, text `#07080C`. Inactive: transparent, border `line-4`, text `#C9CDD6`.

### Filter chip (dropdown)
Height 40, padding 0 14, radius 12, fill `rgba(255,255,255,.03)`, border `line-3`, text `#C9CDD6` 13, with a trailing 12 px chevron (stroke 2.2) and gap 6. It opens a glass popover (radius 16, padding 8) containing checkable rows 40 tall.

### Tag chip (keywords, reasons)
Height 30, padding 0 12, radius 999, border `line-4` (or `line-5`), 13 px, `#C3C8D1`.

### Mono tag (history precision and kind)
Mono 11, padding 3 8, radius 6, fill `fill-tag`, `#C3C8D1`. The text is `exact day`, `month only`, `year only`, `first watch` or `rewatch`.

### Badge (search results)
Mono 11, padding 4 9, radius 999, border `line-6`, `#C9CDD6`.

### Poster
`<Poster film size>` renders the cached image (`object-fit: cover`) with aspect 2 / 3, `overflow: hidden` and shadow `0 22px 44px -22px {palette dark or bg}`. Radius by size: wall 12, timeline 10, small 10, detail and top pick 16, search thumbnail 6 (36×54). Wall cards (`.poster-card`) have the tilt hover from `theme.css`.

**PosterArt** is the generative fallback when there is no image, and it is exactly what the mockups show:
- **Background**: the palette dark colour (or glow for light posters). **Foreground**: the contrasting palette colour.
- **Layout**: padding 14, flex column with space-between. The year sits top-left in mono 11 at 85% opacity; the title sits bottom-left in Unbounded 600 at 15 px, lh 1.15, balanced.
- **Motif**: one of three, chosen by `tmdb_id % 3`:
  - `sun`: a circle 72% wide at right −18%, top 16%, fg at 18% opacity.
  - `band`: a full-width bar at top 42%, height 13%, fg at 16%.
  - `arch`: left/right 16%, top 20%, height 46%, radius 999 999 0 0, a 2 px fg border at 32%.

Under each wall poster: the title (14 / 500, ellipsis) with `★ 4.5` (mono 12, `#E6E1C8`) at the right, then "Director · date" (12, `#8E95A3`, ellipsis, margin-top −6). The card gap is 10.

### StarRating (input)
Five 40×44 buttons, gap 2, each with a 26 px star path (`M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z`) at stroke 1.4. Filled stars use `#F5D88A`, empty ones `#5C6270`; a half star uses a linear-gradient fill split at 50%. The label above reads "Rating · 4.5". Keyboard: ←/→ steps by 0.5 and Backspace clears.

### Inputs
Height 44, padding 0 12–14, radius 12, fill `fill-input`, border `line-4` (date: `line-5`), 14 px white text, and `color-scheme: dark`. Every input has a `<label>`; where the design shows only a placeholder, the label is visually hidden. The textarea has 2 rows, padding 12 14, and vertical resize.

### Command palette (cmdk)
- **Scrim**: the page behind blurred 10 px at 55% opacity, plus `rgba(4,5,8,.62)`. In the app, blur the real page with `backdrop-filter` on the overlay.
- **Dialog**: max-width 760, top offset 72, radius 24, bg `rgba(20,22,30,.72)`, border `line-4`, `backdrop-filter: blur(40px) saturate(140%)`, shadow `0 60px 120px -40px rgba(0,0,0,.9), 0 0 0 1px rgba(0,0,0,.4)`.
- **Input row**: height 68, padding 0 22, gap 14, bottom border `line-1`. A 20 px search icon `#A3A9B6`, the input at 20 px, and an `Esc` kbd.
- **Results**: a section header in mono 11 (ls .08em, `#8E95A3`) with "TMDB · N RESULTS" and the debounce time. Rows have padding 8 12, radius 14, gap 14, and hover `fill-ctl`.
- **Log form panel**: margin 6 12 12, padding 20, radius 18, fill `fill-glass`, border `line-1`, gap 18. The title is Unbounded 16 / 500: "Log Title (Year)".
- **Footer**: padding 14 22, top border `line-1`. Keyboard hints in 12 `#A3A9B6` with kbd chips; the primary "Log watch ↵" sits on the right.

### Charts (hand-built SVG/HTML)
- **Heatmap**: 14 px cells, gap 3, radius 3, 53 week-columns × 7 rows, Monday first. Day labels Mon/Wed/Fri/Sun in mono 10 `#8E95A3` sit in a 27 px column. Month labels in mono 11 sit above the first week of each month. The legend reads "none ▢ ▢ ▢ 2 films". Hover gives a 1.5 px white outline plus a tooltip "Oct 3: 1 film".
- **Radar**: viewBox `-30 0 380 300`, centre (160,150), R 105, 4 rings at 25/50/75/100%, rings and spokes `rgba(255,255,255,.09)`. The data polygon is filled with `color-mix(accent 22%, transparent)` and stroked with accent at 2 px. Vertices are r 4 accent circles with a 2 px `#101218` ring. Labels sit at 1.2R in 12 px `#C3C8D1`. `role="img"` with an aria-label listing the values.
- **BarList** (directors and actors): the name (14) and count (mono 13 `#C3C8D1`) on one line, then a 4 px track (`fill-tag`) with an accent fill whose width is count/max. Row gap 10.
- **Rating histogram**: 10 columns with gap 6, plot height 170 + counts. Bars have radius 4 4 0 0 and use accent (empty bins `rgba(255,255,255,.08)`, min height 2). The count sits above in mono 11 and the bin label below in mono 11 `#8E95A3`, with a 1 px `line-4` baseline. Hover brightens the bar 1.25 and shows a tooltip.
- **Year bars**: a 13-column grid (one per year; scroll horizontally if there are more than 13). Each bar is a button with padding 8 4 and radius 12; the selected one gets fill `fill-tag` and border `line-6`. The total sits on top, then the stacked approx (1.5 px dashed outline, radius 4 4 0 0) and exact (radius 2) segments, scaled to 132 px max, then the year label in mono 12.
- **Score meter**: none. Scores are plain percentages; don't add gauges.

### Taste map canvas
- Radius 24, bg `#0A0C11`, a dot grid (`radial-gradient(rgba(255,255,255,.06) 1px, transparent 1px)` at 28 px) and border `line-2`. 700 px tall on desktop.
- Watched point: a mini poster (radius 3) with `box-shadow: 0 0 18px {colour}, 0 0 0 1px rgba(255,255,255,.18)` and a label underneath (11 px, `rgba(236,238,243,.62)`, or `#FFF` when it is a neighbour of the selection).
- Suggested point: a 44×44 hit target holding a 16 px ring (2 px border, fill `rgba(7,8,12,.6)`, or accent when selected) and a label 38 px below (12 / 500, in the ring colour). Hover scales the ring 1.25.
- Neighbour lines: accent at 55% opacity, 1.5 px, dash 4 4, non-scaling stroke.
- Cluster label: mono 11, ls .14em, `rgba(236,238,243,.5)`.
- Hint "drag to pan · scroll to zoom": mono 11, bottom-left.
- Render with plain DOM + CSS transforms for pan/zoom (fewer than 2,000 points). Switch to a canvas renderer only if there are more than 3,000 points.

## Icons
Use `design/icons.tsx`: 24-unit viewBox, `stroke="currentColor"`, stroke width 1.7 (nav), 1.8 (cards), 2–2.2 (small or bold). Never mix in another icon set.

## Motion (Framer Motion)
- **Route change**: the outgoing page fades out over 120 ms; the incoming page fades in and rises 8 px over 240 ms with `ease [.2,.7,.2,1]`.
- **Poster → detail**: a shared `layoutId` on the poster image (wall, timeline, map side panel, and rec card → detail hero poster), 380 ms spring (stiffness 260, damping 30).
- **Command palette**: the scrim fades in over 160 ms; the dialog scales .98 → 1 with opacity over 180 ms.
- **Lists**: stagger children 20 ms (only on first mount, never on filter changes beyond the first 18 items).
- **Hover**: the CSS recipes in `theme.css`.
- `prefers-reduced-motion`: disable the tilt, pulse, layout morphs and carousel auto-rotate, and use opacity fades only.

## Accessibility checklist
- Text contrast is at least 4.5:1 on `#07080C`. All ink tokens pass; never put `#8E95A3` on glass lighter than 8%.
- Segmented controls and tabs use `aria-pressed` (or `role="tablist"` / `tab` with `aria-selected` where they switch views).
- The command palette uses `role="dialog"` with `aria-modal`, traps focus, and returns focus to the trigger on close.
- Each heatmap cell and map point exposes an accessible name; charts have a "View as table" link (visually small, in the panel header) that toggles a `<table>`.
