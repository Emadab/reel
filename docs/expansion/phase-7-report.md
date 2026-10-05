# Phase 7 report: games

Branch `expansion/phase-7-games`, stacked on phase 6.

## Commits
- `be2c6b5` Settings for shows, books and games: flags, provider keys, mode accents, notifications, attribution. This is brought forward from Phase 8, because games can't be used until you can enter a RAWG key.

Game work that landed earlier:
- `4e29621`: the RAWG provider.
- `70ba3cd`: `app/games.py` (hours, goals, time left).
- `bd7d497`: the backlog planner.
- `7105d0b`: wishlist release, date-change and DLC announcements.
- `940c74d`: the platform per playthrough.

## Checked against the doc
| Deliverable | Status |
| --- | --- |
| IGDB with Twitch OAuth | **Replaced by RAWG**. You couldn't get Twitch two-factor auth |
| RAWG fallback | RAWG is now the canonical source: metadata, covers, platforms, DLC, series, screenshots (stored locally) |
| Steam Web API sync and import | **Skipped**, because there's no Steam key. See open questions |
| Game states, goals (`main` / `main_extras` / `completionist`), `endless` flag | Done. An endless game skips beaten and completed. Endless is guessed from RAWG tags (MMO, sandbox, live service) and can be toggled in the More menu |
| Time-to-beat and time left | RAWG's average playtime, scaled per goal: ×1, ×1.6, ×2.6. A `ponytail:` comment notes the swap to per-goal figures if IGDB is added later |
| Game detail with platform, goal, hours, time left | Done. Log hours and completion %, pick the goal and the platform of the run |
| Backlog planner (backlog books and games by time left) | Done, on the Books and Games libraries, shortest first |
| Announcements: wishlist releases and date changes; new DLC for beaten games | Done (Phase 5 jobs, tested) |
| Derived updates never override `abandoned`, `shelved` or `retired` | Tested in `test_endless_game_and_sticky_states_survive_hours`. Logging hours and derived transitions leave sticky states alone |
| 6-week inactivity prompt | Suggests "shelve it" for a game you're playing; it never changes the state |

## Migrations
None.

## Tests
- Backend: 55 passed (game tests: hours, goal, time left, endless, sticky states, DLC and release announcements).
- Frontend: typecheck clean.
- Live: Settings renders; games search without a key shows "RAWG key missing. Add it in Settings" with a link. A live RAWG run needs your key.

## Manual checks
1. Settings → turn on Games, then paste your RAWG key under Media keys.
2. `Ctrl 4`: search a game, open it, then Start playing. Pick a goal and platform, log hours, watch the time left shrink, and mark it beaten.
3. Add a few games to Backlog: the planner orders them by time left.

## Deviations
- RAWG instead of IGDB (your decision during the build).
- Settings moved here from Phase 8.

## Open questions
- **Steam:** with a Steam Web API key and a public profile I can add playtime sync (every 2 hours, which moves a game to playing unless its run is sticky) and a library import (0 hours to the backlog, the rest to a review screen). Want it?
