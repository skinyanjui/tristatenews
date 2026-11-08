# Comment auto-moderation + self-delete implementation plan

**Goal:** Server-side filter + Approach A cookie ownership on `/api/comments` (still 8 functions). Tests first. No production writes.

## Files

- `api/_cmfilter.js` — classify
- `api/_cmcookie.js` — token, parse, hash, Set-Cookie, HTTPS detection
- `api/_cmatom.js` — CREATE+own, HOLD, AUTOHIDE, OWN_DELETE, DELETE+own/ok, RESTORE+ok
- `api/_comments.js` — ready, mine, owner delete, filter, on-read hide
- `public/assets/app.js` — ready round-trip, Delete, draft on error
- `public/admin.html` — why category
- `public/legal.html` + legal tests — cookie + automated rules
- `test/ship119-comment-filter.test.js`, `test/ship119-comment-own.test.js`, ship118 cookie helper, e2e

## Tasks

1. Filter unit tests then `_cmfilter.js`
2. Cookie unit tests then `_cmcookie.js`
3. Atom scripts + comments API tests (reject/hold/legacy hide/restore/own delete/ready/mine/CDN GET)
4. Client + admin + legal
5. Playwright + lint + full unit
