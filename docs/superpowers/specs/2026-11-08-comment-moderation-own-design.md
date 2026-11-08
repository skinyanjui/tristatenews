# Comment auto-moderation + device self-delete (A)

**Date:** 2026-11-08  
**Status:** User approved filters (“Build it”) and cookie Approach A alongside. Parent ships. Do not merge.  
**Out of scope:** accounts, bookmark/like sync, new functions, paid AI, production writes/refresh, cookie design B.

## Filters (server authoritative)

- `api/_cmfilter.js`: normalize (NFKC, strip zero-width, lower, light leet, punct→space, join single-letter runs) then whole-token/phrase match. No substring search of the compact string (Scunthorpe).
- **reject** (never stored, never visible): strong profanity (fuck/shit/motherfucker/cocksucker/asshole/bullshit and inflections) and explicit racial/ethnic/religious/homophobic/transphobic/disability slurs. Common disguises. Not damn/hell/ass-as-substring.
- **hold** (stored hidden + admin queue): violence/extermination + protected-group phrasing without a slur (`kill all …`, `… should die`, `I hate all …`). Uncertain → review, not a silent public post.
- **ok:** mild language, identity mentions, anti-hate, political criticism, news-like condemnation that does not repeat a slur.
- Limitation: a word list is not a hate-speech model. Quotes that repeat a slur still reject. Residual hate without patterns is reports + admin.
- New reject → 400 generic rules error, draft kept. New hold → 200 `{ok, pending:true, id}` no public body, no slur echoed.
- Legacy: no production scan. On `GET ?id=` only, inspect a bounded vis window (≤40), atomically hide matches unless `tsn:cm:ok:<cid>` (moderator allowed). `GET ?ids=` counts may stay slightly high until a thread is opened. Honest.
- Restore sets ok-key so false positives stay public. Owner-deleted recs have no rec → restore cannot resurrect.
- Hide reason on hide-key: `1` reports, `filter`/`hold` auto. Admin sees a category, not a match hash. Public JSON never has why/own/hash.

## Cookie A (self-delete)

- 32-byte `crypto.randomBytes`, base64url, **hash-only** `sha256` at `tsn:cm:own:<cid>` (same 180d TTL). No new secret. `tsn.uid` is not auth.
- HTTPS canonical/Vercel: `__Host-tsn_cm; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=15552000`. Loopback http: `tsn_cm` without Secure/__Host-. Host-only, no Domain. Secure bit only if loopback exception **or** (`x-forwarded-proto=https` **and** (`x-vercel-id` or Host is www/apex tristatenow.com)). Arbitrary proto spoof on other hosts → not Secure.
- **Round-trip:** `POST {action:'ready'}`. No valid cookie → Set-Cookie, `{ready:false}` (not proven). Valid cookie present → `{ready:true}`, do not issue a second token. **Create requires a valid incoming cookie**; otherwise 400, nothing published. Never `{mine:true}` as proof the browser stored Set-Cookie. Sliding Max-Age refresh only on successful create, same token (no rotate).
- Two first-time tabs may race two Set-Cookie; browser keeps one. Ready-before-create on each tab uses whatever cookie is present on the second ready. Documented limit: a create in flight while another tab overwrites a brand-new cookie can orphan that one rec. Do not issue if a valid cookie is already on the request.
- Public GET ignores Cookie (still `s-maxage=15`, no Vary). `POST mine` / delete / ready / create: `private, no-store`. mine returns ids (and pending ids) never hashes/text.
- Owner `POST {action:'delete', id}` without admin key: EVAL compares own-hash; mismatch or missing own-key → **no writes**, generic 404. Rec already gone → 404 (cleanup leftovers only if hash matched). Admin delete still deletes rec+own+ok+indexes.
- Crime: new posts still fail closed. Owner/admin may delete an existing rec after the story is crime/expired; public GET still returns no text.
- Legacy recs without own-key: never claimable. Shared profile shares Delete. Clear cookies / other browser → no self-delete; text stays until TTL/hide/admin.

## UI

- Comment sheet: two ready POSTs (or ready until `ready:true`) before Post enables. Cookies blocked → honest status, no fake Delete.
- Reject: toast + rules error, textarea kept. Hold: “waiting for review” + Delete on returned id, text not shown in the public list.
- Delete: 44px, confirm, keyboard, errors re-enable. mine on open to mark owned public rows.
