# Phase 6 report: books

Branch `expansion/phase-6-books`, stacked on phase 5.

Most of Phase 6 was already done: the shared media core in Phase 4 carried the book services and pages, and Phase 5 the book announcements. This phase adds the missing piece and checks the rest against the doc.

## Commits
- `940c74d` Track the edition format of a read (print / ebook / audiobook) and the platform of a playthrough as run variants

Book work that landed earlier:
- `70ba3cd`: `app/books.py`, which combines Open Library (canonical work), Hardcover (series, release date) and Google Books (fallback description and page count), and holds the progress rules.
- `4e29621`: the providers.
- `f2b2e10`: the book pages.
- `7105d0b`: followed authors and series.

## Checked against the doc
| Deliverable | Status |
| --- | --- |
| Open Library canonical (work key, covers by id), User-Agent with contact email | Done. Set `CONTACT_EMAIL` in Settings to raise the limit to 3 req/s |
| Hardcover series and release dates; Google Books fallback | Done. Both optional, used only with their keys |
| States through the transition service; progress in pages, percent or audio minutes; `finished` derived at 100% unless the run is sticky | Done and tested |
| Book detail with a progress control | Done (unit, current, total; a toast when you finish) |
| Shelf view | Done: Reading / Want to read / To read (owned backlog) / Finished / Paused / Did not finish, plus All |
| Currently-reading strip | Done, at the top of the Books library |
| Weekly announcements for followed authors and series | Done. Follow from a book's More menu |
| Acceptance flow: search, add to backlog, start, progress, finish, rate, reread as a second run | Covered by `test_book_flow_backlog_progress_finish_rate_reread`; the first half was also run live (Piranesi) |

## Migrations
None in this phase.

## Tests
- Backend: **55 passed**.
- Frontend: typecheck clean.

## Manual checks
1. In Books mode (`Ctrl 3`), search a book and open it. Use Status → "Move to To read (owned)", then Start reading.
2. Log progress: page 50, then the last page. It becomes Finished.
3. Rate it, then Start a reread. Your history now shows two runs.
4. Try Format → Audiobook with Audio min progress.

## Deviations
- Open Library subjects are messy, so they're cleaned up: the `genre:` prefix is dropped, tag noise is removed, and markdown is stripped from descriptions.
- The backlog planner estimates reading time at a flat 1.5 minutes per page (marked with a `ponytail:` comment). It could learn your pace from progress events if that matters.

## Open questions
None.
