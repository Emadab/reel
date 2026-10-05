# Reel: handover package for Claude Code

Everything Claude Code needs to build the movie tracker exactly as designed.

**Start here:** `KICKOFF_PROMPT.md` has the message to paste into Claude Code.

```
CLAUDE.md                     project memory for Claude Code (stack, rules, commands); goes in the repo root
KICKOFF_PROMPT.md             what to paste to start
.env.example                  backend secrets template
docs/
  PRODUCT_SPEC.md             every feature and behaviour
  ARCHITECTURE.md             data model, API contract, TMDB/OMDb, palette extraction, recommender, taste map
  DESIGN_SYSTEM.md            tokens, type, components, charts, motion, responsive rules, accessibility
  SCREENS.md                  screen-by-screen layout, data bindings, states, design extensions
  BUILD_PLAN.md               6 phases with acceptance criteria
design/
  screenshots/*-desktop.png   reference renders at 1440 px (the visual source of truth)
  static/*.html               the same screens as plain HTML/CSS (open in a browser, inspect values)
  reference/*.dc.html         design source from the canvas (templates + fixture data + state logic)
  theme.css                   Tailwind v4 theme, fonts, glass/eyebrow utilities, hover and pulse recipes
  icons.tsx                   all icons as React components
  fixtures/sample-data.json   data that reproduces the screenshots (for fixture mode and visual tests)
```

Notes:
- The posters in the mockups are generated placeholders. The real app shows cached TMDB posters and keeps the placeholder style ("PosterArt") as the fallback when an image is missing.
- The data in the fixtures and screenshots (watch history, counts, model numbers) is sample data. Film titles, directors, cast and runtimes are real.
- The mockups are desktop only. The responsive rules in `DESIGN_SYSTEM.md` define the tablet and phone layouts.
