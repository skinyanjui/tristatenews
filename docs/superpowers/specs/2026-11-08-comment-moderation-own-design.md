# Comment auto-moderation + device self-delete (A)

**Date:** 2026-11-08  
**Status:** User approved filters (“Build it”) and cookie Approach A alongside. Parent ships. Do not merge.  
**Out of scope:** accounts, bookmark/like sync, new functions, paid AI, production writes/refresh, cookie design B.

## Filters (server authoritative)

- `api/_cmfilter.js`: normalize (NFKC, strip zero-width, lower, light leet, punct→space, join single-letter runs) then whole-token/phrase match. No substring search of the compact string (Scunthorpe).
- **reject** (never stored, never visible): strong profanity used as abuse; slurs used as a directed insult or as the whole comment; hate slogans (`heil hitler`, `kill all jews`, …). Common disguises. Not damn/hell/ass-as-substring.
- **hold** (stored hidden + admin queue): violence/extermination + group phrasing without a slur; **mentions** of a slur/profanity (quoting, “don’t use the word X”, some medical/colloquial `retarded`). A “don’t say X” wrapper is **not** a publish bypass: it holds or, with a directed slur / hate slogan, still rejects.
- **ok:** mild language, identity mentions, anti-hate that does not repeat a banned token, political criticism.
- Limitation: a word list is not a hate-speech model. Residual hate without patterns is reports + admin. Mentions can over-hold.
- New reject → 400 generic rules error, draft kept. New hold → 200 `{ok, pending:true, id}` no public body, no slur echoed.
- **Public GET is a pure view.** Expiry prune (`ZREMRANGEBYSCORE`) may write; classification does **not**. The full vis set (≤200/story) is classified in memory; matching recs are omitted from the page **and** the count. `GET ?ids=` uses the same filter so card counts match the thread. Opening a thread does not hide, enqueue, or drop vis members.
- **Admin `POST {action:'sweep'}`** (existing admin key, ≤40 stories / ≤50 hides per call, versioned `tsn:cm:fsweep:<storyId>`): AUTOHIDE matches unless `tsn:cm:ok:<cid>`. Puts legacy text into the review queue without making it public. No cron, no news-refresh hook, no production run from this PR.
- Restore sets ok-key so false positives stay public. Owner-deleted recs have no rec → restore cannot resurrect.
- Hide reason on hide-key: `1` reports, `filter`/`hold` auto. Admin sees a category, not a match hash. Public JSON never has why/own/hash.

## Cookie A (self-delete)

- 32-byte `crypto.randomBytes`, base64url, **hash-only** `sha256` at `tsn:cm:own:<cid>` (same 180d TTL). No new secret. `tsn.uid` is not auth.
- HTTPS canonical/Vercel: `__Host-tsn_cm; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=15552000`. Loopback http: `tsn_cm` without Secure/__Host-. Host-only, no Domain. Secure bit only if loopback exception **or** (`x-forwarded-proto=https` **and** (`x-vercel-id` or Host is www/apex tristatenow.com)). Arbitrary proto spoof on other hosts → not Secure.
- **Round-trip:** `POST {action:'ready'}`. No valid cookie → Set-Cookie, `{ready:false}` (not proven). Valid cookie present → `{ready:true}`, do not issue a second token. **Create requires a valid incoming cookie**; otherwise 400, nothing published. Never `{mine:true}` as proof the browser stored Set-Cookie. Sliding Max-Age refresh only on successful create, same token (no rotate).
- Two first-time tabs may race two Set-Cookie; a single cookie jar keeps the last one. Ready-before-create uses that jar token, so both later posts are owned by it. **Same-connection issuance is SET NX** (`tsn:cm:issue:<ipHash>`, 3s): a second ready without a cookie does not rotate the jar, so an in-flight create keeps Delete. Client retries ready until `{ready:true}` (or gives up) so the loser tab picks up the winner’s cookie. After create/hold, Delete is shown only if `POST mine` includes the id (honest if the jar ever differs). Different IPs (two browsers) still each get a cookie. Ready issuance and mine have their own per-IP burst caps (not the post quota).
- Public GET ignores Cookie (still `s-maxage=15`, no Vary). `POST mine` / delete / ready / create: `private, no-store`. mine returns ids (and pending ids) never hashes/text.
- Owner `POST {action:'delete', id}` without admin key: EVAL compares own-hash; mismatch or missing own-key → **no writes**, generic 404. Rec already gone → 404 (cleanup leftovers only if hash matched). Admin delete still deletes rec+own+ok+indexes.
- Crime: new posts still fail closed. Owner/admin may delete an existing rec after the story is crime/expired; public GET still returns no text.
- Legacy recs without own-key: never claimable. Shared profile shares Delete. Clear cookies / other browser → no self-delete; text stays until TTL/hide/admin.

## UI

- Comment sheet: ready until `ready:true` (immediate round-trip, then short retries) before Post enables. Cookies blocked → honest status, no fake Delete.
- Reject: toast + rules error, textarea kept. Hold: “waiting for review”; Delete only after mine confirms the jar owns the id.
- Delete: 44px, confirm, keyboard, errors re-enable. mine on open and after create to mark owned rows.
