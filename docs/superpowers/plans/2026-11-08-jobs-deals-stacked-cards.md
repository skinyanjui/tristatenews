# Jobs/Deals stacked cards Implementation Plan

> Inline execution in this session (approved spec, no further design questions).

**Goal:** Replace the news-row Jobs/Deals footers with compact stacked cards and a full-width View button that opens a local detail dialog.

**Architecture:** `jobCard` / `dealCard` build stacked `article.job.row-job` / `article.deal.row-deal` instead of `UI.row`. `boardDetails(it, kind, b, opener)` opens `dialog.bd-sheet` using the `evxDetails` pattern. CSS in `public/assets/app.css` under `#jb` / `#dl`. Samples stay client-side `BOARD_SAMPLES`.

**Tech Stack:** Vanilla JS in `public/assets/app.js`, CSS in `public/assets/app.css`, Node `node:test`, Playwright e2e.

## Global Constraints

- 8 Vercel functions; no new API files
- Redis/KV/EXTRA_FEEDS/SITE_URL unset in tests; mock listings GET; intercept POST/checkout
- Keep 16 samples; all-page one-row 44px chip strips
- No header/unrelated cards; model unchanged
- No prod submissions/payments/crawl/refresh/secrets
- Do not merge; parent ships

---

### Task 1: Failing tests (TDD red)

**Files:**
- Create: `test/ship116-jobs-deals-stacked.test.js`
- Modify: `e2e/jobs-deals-stacked.spec.js` (new), then later `e2e/jobs-deals.spec.js`, `e2e/jobs-deals-mobile.spec.js`, `test/ship75-shared-rows.test.js`, `test/ship113-jobs-deals.test.js`, `test/ship115-jobs-deals-mobile.test.js`

- [ ] Unit test asserts stacked markup (`function boardDetails`, `View job`, `View deal`, `Demo listing`, `bd-sheet`, no sample Apply/Copy, real Apply/Copy only with working contact/code, chips nowrap, 8 functions).
- [ ] Playwright: card/CTA/image/text bounds vs card and viewport at 320/360/375/390/414/430/768/1280 light/dark and 200% zoom; long real + sample; no-image; featured; keyboard open/close/focus; filters still work.

Run unit test; expect FAIL (boardDetails / View job missing).

### Task 2: Cards + dialog (TDD green)

**Files:**
- Modify: `public/assets/app.js` (`jobCard`, `dealCard`, add `boardDetails`)
- Modify: `public/assets/app.css` (stacked `#jb .job` / `#dl .deal`, full-width `.bd-view`, `.bd-sheet`; remove Jobs/Deals `.src` nowrap footer as the card chrome)
- Modify: existing tests that encoded the news-row CTA
- Run: `node scripts/build-assets.js`

`jobCard` / `dealCard` no longer call `UI.row`. News/classifieds/obits/events still do.

### Task 3: Verify and PR

- `npm run lint`, `npm test`, Playwright Jobs/Deals specs
- Screenshots under `/opt/cursor/artifacts/stacked-*`
- Commit, push `cursor/jobs-deals-stacked-7ac5`, PR to `main`, do not merge
