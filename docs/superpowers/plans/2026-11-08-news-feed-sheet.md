# News feed + preview sheet Implementation Plan

**Goal:** Photo-led news cards and a matching article preview sheet from latest main (`7990fdc`), without touching Jobs/Deals or other boards.

**Stack:** `public/assets/app.js` (`makeCard`, `storySheet`), `api/_cards.js` (first-paint markup), `public/assets/app.css` (ship117 block before ship81). Tests: `node:test` + Playwright.

## Constraints

- 8 Vercel functions; Redis/KV unset in tests; mock `/api/news`
- No prod crawl/refresh/writes/secrets
- Parent ships; do not merge

## Task 1: Failing tests

- `test/ship117-news-feed-sheet.test.js`: stacked `news-story` markup, publisher-then-photo, compact no-image, Continue red / full-contrast summary, no comment/bookmark, 8 functions, Jobs still stacked
- Update ship74/75/69 assertions that encoded CNN rows for news only
- `e2e/news-feed-sheet.spec.js`: 320–1280 light/dark + 200% zoom bounds; long headline/publisher; no-image; image error; sheet focus/Escape/backdrop; Continue URL; reactions do not navigate; swipe/keyboard still present
- Jobs/Deals regression specs unchanged in intent

## Task 2: Implement

- `makeCard(!big)` → `article.card.news-story`; Breaking unchanged; `obitRow` unchanged
- `_cards.js` matches client for non-Breaking news
- CSS: stacked card, 44px foot, exclude `.news-one` from the shared-row `gap:0` collapse
- Sheet: publisher above photo, `st-sum` foreground, Continue `--wordmark-now` / red, 44px Close

## Task 3: Verify + PR

`npm run lint`, `node --test test/`, Playwright news-feed-sheet + jobs-deals. Screenshots 390 light/dark feed+sheet and desktop. PR to `main`, watch CI, do not merge.
