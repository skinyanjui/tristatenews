# News comments + bookmarks (approved B)

**Date:** 2026-11-08  
**Status:** Approved in plain language. Routine implementation details do not need another approval.  
**Parent ships. Do not merge.**

## What readers get

- **Public comments** on non-crime news: anonymous (no name, email, or account), short plain text, shared with everyone.
- **Reporting + moderation:** readers report; three distinct hashed-IP reports hide a comment; an authenticated admin restores or deletes it from a real queue on `/admin`.
- **Comments off for crime / Police & courts** in both UI and server, using trusted story metadata (never a client-claimed category). Unknown metadata fail-closed.
- **Bookmarks** are a distinct control from the heart. Saved articles live in this browser (`tsn.saved`). Hearts keep public like counts plus a separate local pressed state (`tsn.liked`).

## Out of scope

Accounts, cross-device sync, paid services, new Vercel functions, comment threads/replies, notifications, new auth, private comments pretending to be public, production writes from tests.

## Bookmarks

- Real Save control on news cards and the story sheet (`aria-pressed`), 44px targets, independent of the heart.
- **Saved articles** surface (header control → sheet): retrieve, remove, empty state. Cards store a snapshot (title, link, summary, image, published, source, sourceId) so expired feed items still appear. Continue uses existing `safeHref`. Cap 200, newest first.
- Migration: existing `tsn.saved` stays saved items. Seed `tsn.liked` from those links once so historic hearts stay pressed. Do **not** POST `/api/react` during migration (no double-count / no reset of Redis like sets).
- Heart toggle writes `tsn.liked` + `/api/react` only. Save toggle writes `tsn.saved` only (no public post).
- Card, sheet, and Saved list stay in sync; a news refresh must not lose selection.
- localStorage blocked/quota: toast an honest failure and revert; never show saved/pressed when persist failed. Session-only state is allowed only if we say so; default is revert.
- Events/obits keep hearts only (not the Saved list).

## Comments

- Hosted at `/api/comments`, rewritten onto existing `api/react.js` (still **8** functions). Same Redis as hearts. Without Redis: `{ configured: false }` and the UI says comments aren’t available — no local fake thread.
- Compose ~300 characters, strip `<>`/controls, collapse space, **no links**. Render with `textContent` only.
- GET `?id=` thread (bounded, newest first, ≤20) and GET `?ids=` batched counts. POST create / report. Admin GET `?review=1` + POST restore/delete with `x-admin-key` = existing `LISTINGS_ADMIN_KEY` (constant-time compare; wrong key → 404 like listings).
- Rate-limit uid + hashed IP (existing `_ip.js`, 24-hour counters). Never store uid or raw IP on the comment record or public/admin JSON.
- Report dedup: `SADD` hashed IP; `SCARD` ≥ 3 hides and queues. Repeat IP does not extra-count. Hide/restore/delete/create are one Redis EVAL on a visible ZSET (`tsn:cm:vis:<story>` scored by expiry); counts are ZCARD after pruning, never a read-modify-SET.
- Allowlist: refresh writes `tsn:news:ids` **and** `tsn:news:meta` (storyId → `{kind, title, sourceId}`) from the snapshot. POST requires current id + allowed meta. GET uses the same meta; police/courts, crime-title (`CRIME_RE` matching the page), unknown kind, missing meta, or expired/unknown id → not allowed, empty thread (stored comments are not readable). Client category is ignored. First deploy: comments stay fail-closed until a normal refresh writes meta (do not trigger a production refresh).
- Same-origin CSRF on POST (Origin/Referer host must match `Host`); method/size checks; storage errors fail closed.
- TTL **180 days** on comment records and report sets. Visible index capped at 200; GET thread is 20 plus `total` (show X of Y / load more).
- No threads, no notifications, no names.

## Admin (reachable)

Open `/admin` (rewrite of `/admin.html`). Paste `LISTINGS_ADMIN_KEY` in the **existing** key field (same as reported posts). **Reported comments** lists hidden comments with Restore / Remove. Never put the secret in JS, HTML, or docs.

Moderation load is explicit: anonymous public comments will be abused; the queue is the workflow, not an unused API.

## Privacy / legal

Describe public comment text + 180-day retention + hashed-IP reports/rate limits + admin review; browser-only saves; separate `tsn.liked` vs `tsn.saved`. Do not describe bookmarks as public.

## Preserve

Mugshot suppression, news refresh/caching, article URL validation, outlet Continue, keyboard/Escape/swipe, global style, other boards, header, Jobs/Deals.

## Tests (isolated)

Server: allowlist, crime, unknown/expired, abuse, report dedup, admin auth, XSS, concurrency, degraded storage, CSRF/method/size. Redis/KV unset in the suite; mock store only.  
Browser: card/sheet comment, save/unsave, Saved list, migration, heart independence, reload, no-image, long text, 320–1280 light/dark, 200% zoom, 44px. Full unit/lint + Jobs/Deals regression.  
Zero production comment/like/report/admin writes, news refresh, crawl, or secrets changes. Fixture screenshots labeled EXAMPLE.
