# News comments + bookmarks Implementation Plan

**Goal:** Public comments (report + admin queue, off on crime) and separate browser bookmarks / Saved list, from latest main (`951c0f7`), without new functions or accounts.

**Architecture:** `/api/comments` → `api/react.js` via `_dispatch.js` + vercel rewrite. `api/_comments.js` + `api/_crime.js`. Bookmarks are client-only (`tsn.saved` / `tsn.liked`). Admin queue in `public/admin.html`.

## Constraints

- 8 Vercel functions; Redis/KV unset in tests; mock store
- No prod crawl/refresh/comment/like/report/admin writes/secrets
- Parent ships; do not merge

## Task 1: Failing tests

- `test/ship118-news-comments-bookmarks.test.js`: API allowlist/crime/unknown/expired/abuse/report-dedup/admin/XSS/concurrency/degraded/CSRF; 8 functions; rewrite; CRIME_RE matches the page; no uid/IP in public JSON
- Client source: distinct `sv-btn` / `cm-btn`, `tsn.liked` vs `tsn.saved`, migration without `/api/react` POST, honest persist failure, comments off for police/courts/crime
- Update ship117 (buttons now present), ship67 `idsCmds` (+ meta SET), redis-batching command counts (+1 SET), legal DESCRIBED keys, api-routes ADDED `comments: react`, routes hearts still work
- `e2e/news-comments-bookmarks.spec.js`: card/sheet comment + save, Saved list, migration, heart independence, reload, no-image, long text, 320–1280 light/dark, 200% zoom, 44px; fixture screenshots

## Task 2: Server

- `idsCmds(items, ttl, sources)` also `SET tsn:news:meta` JSON `{ [storyId]: {kind, title, sourceId} }` EX 2 days
- `_comments.js`: clean/hasLink like listings; GET thread + batch counts; POST create/report; admin review/restore/delete; hashed IP RL; hide at 3 unique IPs; TTL 180d; fail closed
- Wrap `api/react.js` with `host({ comments })`; rewrite + `server.js` `/api/comments`; LLEN in local Redis emulator if used

## Task 3: Client + admin + legal

- Split heart (`toggleLiked` / `tsn.liked`) from bookmark (`toggleSaved` / `tsn.saved`); seed liked from saved once
- `cm-btn` / `sv-btn` on news cards + sheet; comments sheet (load/empty/error/unavailable/compose/report); Saved sheet
- `admin.html` Reported comments using the existing key field
- Privacy/Terms/README: comments retention, browser saves, admin steps **without** the secret
- CSS: 44px comment/save; Jobs/Deals untouched

## Task 4: Verify + PR

`npm run lint`, `node --test test/`, Playwright news comments/bookmarks + jobs-deals + news-feed-sheet. Screenshots 390 light/dark comments + Saved, labeled fixtures. PR to `main`, watch CI, do not merge.
