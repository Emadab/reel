# Kickoff prompt for Claude Code

Unzip this package into an empty folder, `cd` into it, start Claude Code, and paste the following:

---

This folder is a handover for a new app. Start by reading `CLAUDE.md`, then everything in `docs/`, and look at every image in `design/screenshots/`. Open a couple of the `design/static/*.html` files so you know where to find exact CSS values.

Then:
1. Tell me in a few lines what you understood the app to be, and list anything in the docs that is contradictory or unclear. Wait for my answers before writing code.
2. After that, work through `docs/BUILD_PLAN.md` one phase at a time, starting with Phase 0. Follow the rules in `CLAUDE.md`. Above all, the screenshots are the source of truth for the UI, so copy exact values and never round them to Tailwind defaults.
3. At the end of each phase, run the tests, typecheck and visual comparison. Then stop and give me a summary covering what was built, how to try it, any deviations from the design, and every design extension you added. Wait for my go-ahead before starting the next phase.

---

Tips:
- Get a TMDB token before Phase 1 (themoviedb.org → Settings → API → "API Read Access Token") and put it in `backend/.env` (see `.env.example`).
- If Claude Code drifts from the look, point it at the specific screenshot and the matching `design/static/<Name>.html` element, and ask it to diff its own screenshot against the reference.
- Phase 4 goes much better with real data. Have your Letterboxd export (Settings → Import & Export → Export your data) or your IMDb ratings CSV ready.
