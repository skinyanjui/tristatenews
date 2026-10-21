# Legal page review: October 18, 2026 update

`public/legal.html` was updated on October 18, 2026 so that it describes what the site does now: ads PRs 1–4
(catalog, webhook/refunds, house units, in-listing card) and the planned obituary "Send flowers" link. **It is a
template, not legal advice.** Every item under "Needs review" should be checked by a lawyer licensed in Indiana (and
an accountant where noted) before the site sells anything.

## What changed

### Terms of Use (Last updated October 18, 2026)
- **§4 Obituaries:** points to the planned "Send flowers" link in the Advertising Policy.
- **§7 Paid Featured posts:** rewritten to match `api/_catalog.js`, `public/featured.js`, `api/_checkout.js` and `api/stripe-webhook.js`:
  - **Current prices** (catalog version 2026-10-18): job $99/30 days, deal $79/14, event $59/7, classified $19/7, USD. Obituaries can't be featured.
  - **Price lock:** new prices apply only to new purchases. Existing purchases keep their price and days (`HISTORY`).
  - **Period:**
    - It starts at payment, or when the current Featured period ends.
    - Events, and deals with an end date, are capped at midnight Central time on that date, at the same full price. The button and checkout show "until <day>".
    - A purchase that would add less than a day is refused.
    - Undated posts are kept on their board until the period ends.
    - Checkout pages expire after 1 hour.
  - **Payments:** handled by Stripe. We never see or store card details, and we keep order records.
  - **Refunds**, reconciled with the code:
    - A payment that arrives after the post is gone or its date has passed is flagged (`needs_refund`) and refunded.
    - An amount mismatch is not applied, and is reviewed and refunded.
    - When we remove a post, or reports hide it, it is reviewed (`needs_review`). No refund is due if the post broke the terms; otherwise the unused portion is refunded. This is unchanged from the old §7, and the Service-failure case is kept.
    - A poster deleting their own post gets no refund (`removed_by_poster`).
    - A full refund ends that order's Featured period, and other paid periods are kept. A partial refund changes nothing.
    - Disputes are recorded and answered through Stripe.
  - Refunds go to the original payment method.

### Privacy Policy (Last updated October 18, 2026)
- **Payments row:** Stripe collects the card details on its own page, and we never receive them.
- **New "Order records" row, with exactly what `api/_orders.js` and the webhook store:**
  - Stripe session and payment IDs, the post ID and board, and the price, period and price version.
  - The amount and currency paid, and any refund or dispute (amount, status and Stripe's reason).
  - For removals: the post ID, title and Featured end date.
  - No name, email or card data.
  - Retention: unpaid orders 30 days; money and removal records no automatic expiry; Stripe event IDs 30 days.
- **Advertising inquiries:** now lists "what you're interested in" (the `interest` field the form stores).
- **New "Ads" paragraph:**
  - Our own ads use no reader data and rotate by date.
  - They set no cookies and store nothing in the browser.
  - We don't record views or clicks, and we use no analytics tools.
- **Cookies section:**
  - No ad network or analytics code today.
  - If one is added, the policies are updated and a consent notice is shown first, where required.
  - A network may personalize its ads under its own rules; our own ads never are.
  - Affiliate partners may set their own cookies on their site.
- **Sharing:** Stripe receives the post's ID, title (the checkout product description) and board, plus the price and period.

**Privacy audit (October 18, 2026)**, checked against the code and pinned by `test/legal.test.js`:
- **Browser storage:**
  - Every key is listed: `tsn.theme`, `wxLoc`, `tsn.saved`, `tsn.recent`, `tsn.nl`, `tsn.uid`, and `tsn.mine*` for each board.
  - There are no county preferences in browser storage (the county plan is parked), and no sessionStorage.
- **No tracking code:** no cookies set by the site; no analytics (no Vercel Analytics, GA, gtag or pixels); no ad-network code.
- **Server:**
  - Hearts: browser ID, 180 days.
  - Posts: as described, with TTLs as listed.
  - Tips: latest 500.
  - Ad inquiries: latest 300, including `interest`.
  - Newsletter: email until unsubscribed.
  - IP rate-limit counters: 24 h. Report lists: 30 days.
  - Orders: as above.
- **Unchanged and still accurate:** the Hosting/Fonts/Weather/Ticketmaster/favicons list, and the Upstash/Resend/Stripe processors.

### Advertising Policy (Last updated October 18, 2026)
- **§1 Kinds of placement:**
  - Sponsor lines, sponsored cards (one per board, after the 6th post or at the end) and side ads.
  - House units labeled "Advertise with us".
  - Featured posts, linked to Terms §7.
  - Packages: "available by inquiry", with no prices or contents.
  - Newsletter sponsorship not offered until its gates are met (confirmed subscribers, measured deliverability, defined inventory).
  - Text-only ads: no autoplay, pop-ups or sticky ads.
- **§2 Where ads appear:**
  - Only on Events, Jobs, Deals and Classifieds.
  - None on News, All, Police & courts, Institutions, Obituaries, breaking-news alerts or search results.
  - The obituary "Send flowers" link is the one stated exception, and it is a link, not an ad.
- **§3 No targeting (new):** everyone sees the same ad, rotating by date, and no reader data is used. A future network may target only under its own rules and our updated policies.
- **§5 Labels and links:** "Sponsored" or "Featured · Paid", the "Advertise with us" house unit, https links, rel="sponsored", new tab.
- **§7 Affiliate links (new):**
  - Links are labeled "paid link" with rel="sponsored", and we may earn a commission. None are in use today.
  - The planned "Send flowers" link goes to the funeral home's florist page when one exists, otherwise to an affiliate link labeled "paid link".
  - It is a link only, with no ad, script, cookie or pixel. A commission never affects obituaries.
  - No partner is named until Sam joins a program.
- **§8 Ad networks (new):**
  - None are used today.
  - Before any network ad appears, the policies are updated and a consent notice is shown where required.
  - Network ads would be labeled "Advertisement" and kept out of the ad-free sections.
- **§10:** points to Terms §7 for Featured prices.

Copyright & DMCA, Corrections & Removals and Accessibility are unchanged.

## Placeholders only Sam or a lawyer can fill (unchanged)
- `[LEGAL ENTITY NAME]`: the operating person or LLC.
- `[MAILING ADDRESS]`
- `[DMCA AGENT NAME]` and `[DMCA AGENT EMAIL]`: as registered at dmca.copyright.gov.
- `[COUNTY]`: the venue for disputes (Terms §13).
- The contact email is filled with the site's current address. Sam may swap in a dedicated one.

## Needs review
1. **Sales tax (accountant):** whether Featured posts and ad placements are taxable in Indiana (and in Kentucky or Illinois for out-of-state buyers). Checkout charges tax-exclusive prices and collects no tax today. Stripe Tax is an option.
2. **Make-goods vs refunds (lawyer):** §7 promises refunds of the unused portion. Decide whether a make-good (extra featured time) may replace a refund, and whether "Fees aren't refundable" with these exceptions is enforceable and consumer-law compliant. This covers Indiana deceptive-practices law and card-network rules.
3. **Full price for a capped period (lawyer):** confirm that showing "until <day>" at the full price before checkout is adequate disclosure.
4. **Removal-for-breach review:** the review standard and who decides. There's no written appeal process yet.
5. **Disputes:** whether to state what happens to Featured status when a dispute is lost (the code keeps the post Featured).
6. **Future ad network consent (lawyer):** what a consent notice needs before AdSense or another network: state privacy laws (Indiana, Kentucky and others), any EU/UK visitors, and Google's EU User Consent Policy. Update the Privacy and Advertising policies first.
7. **Affiliate disclosure (lawyer):** whether "paid link" next to the link is enough under the FTC Endorsement Guides. Also check the chosen program's own disclosure terms once Sam joins.
8. **The obituary exception:** the "Send flowers" link is described as a link, not an ad. Confirm that this is how Sam wants it framed, and that the funeral-home florist link needs no agreement with the funeral home.
9. **Record retention:** confirm how long order records must be kept for tax purposes, then set a retention period instead of "no automatic expiry".
10. **Refund-on-request wording:** §7 says payments for missing or past-date posts are flagged and refunded. Refunds are issued by hand in the Stripe dashboard (`/admin.html` lists them). Confirm a turnaround time if one should be promised.

## Ads PR C: advertiser creatives (Advertising Policy §7, Privacy)
- **Advertising §1:** "text only" becomes "words alone, or one still image with a short headline and text"; still no animation, autoplay, sound, pop-ups or sticky ads.
- **Advertising §5:** an ad links to an https page, a map or directions page, or a phone number; rel="sponsored"; web links open in a new tab.
- **Advertising §7 Ad images, words and review (new; later sections renumbered 8–11, cross-references updated):**
  - Upload needs an inquiry reference with its email, an order number, or a signed 14-day link. No anonymous uploads.
  - Image: still JPEG/PNG/WebP, 300×150 minimum, 4,000 px maximum side, 300 KB maximum, no animation; legible; no imitation of news, site labels, fake buttons or system messages.
  - Words: headline ≤ 60 characters (also the alt text), text ≤ 140, no web addresses in the words.
  - Button from the fixed list; destination https page, U.S. phone number, or Google/Apple/Bing Maps or OpenStreetMap link; final address only, no shorteners or redirects; no password prompts or downloads; landing page matches the ad.
  - Review: a person reviews every ad, nothing runs until approved, every approve/reject has a recorded reason, approved ads run only in the chosen spots, can be taken down at any time with a recorded reason; rejected/withdrawn images deleted, decision record kept.
- **Privacy:** a new row for ad uploads (what is stored, the reference, review decisions; inquiry email checked, not stored again; network address only for the daily upload limit) with retention (pending 60 days, approved while it runs, rejected/withdrawn record 1 year without the image, review log latest 1,000, daily counter 1 day). Upstash's description now includes ad uploads.

### Needs review (PR C)
11. **Advertiser notice of decisions:** the policy says decisions have a recorded reason but doesn't promise to notify the advertiser; nothing emails them automatically today. Decide whether to promise a notice and a turnaround.
12. **Rights in creatives (lawyer):** the policy makes the advertiser responsible for rights to images, logos and words. Consider an advertiser agreement or an upload checkbox granting Tri-State News a license to display the creative, with an indemnity.
13. **Takedown standard:** "we can take an approved ad down at any time" — confirm how that interacts with any paid package (refund or make-good when an ad is withdrawn mid-run).

## Ads PR 4.2: placeholder sample ads (Advertising Policy §1 and §5)
- **§1:** a new bullet: some unsold spots show placeholder sample ads labeled "Sample ad"; the businesses are made up and not real advertisers; each links only to our advertising page; a real approved ad always comes first; samples follow the same placement rules (only the four boards).
- **§5:** placeholder sample ads are labeled "Sample ad."

### Needs review (ads PR 4.2)
14. **Made-up businesses (lawyer):** sample ads show invented business names. They were checked against a web search, but a name could still match a real business somewhere in the footprint. The "Sample ad" label and the link to our own page reduce confusion; confirm the wording is enough, and drop any name that turns out to be real.

## Ads PR 4.3: the obituary "Send flowers" link (Obituaries §4, Advertising Policy §2 and §8, Privacy §3)
- **Obituaries §4 and Advertising §2:** "planned" removed; the link is described as a small text link only, not an ad.
- **Advertising §8:** the only affiliate link we may use is "Send flowers", and only after we join a flower-delivery affiliate program (none appear until then). A link to a funeral home's own florist page is used only where we've confirmed the page, and isn't paid. Otherwise the affiliate link is labeled "paid link" (rel="sponsored noopener") and may earn a commission at no extra cost. With neither, no link. No ad, image, script, cookie or pixel; the link carries nothing about the reader or the person who died. The service is still not named.
- **Privacy §3:** "Affiliate links" now covers the Send flowers link: the partner's site may set its own cookies; the link carries only our affiliate code; we don't record who clicks; a funeral-home florist link isn't an affiliate link.

### Needs review (ads PR 4.3)
15. **Naming the partner:** the code is built for Florist One, but the policy still doesn't name it. Florist One's affiliate agreement (§3(f)) says affiliates may not use its name on their websites except as its own materials include it or it approves in writing. Once Sam joins, check whether naming it in the Advertising and Privacy policies is allowed or needs its written OK, then name it.
16. **Florist One terms (Sam):** the agreement also forbids changing the links it provides and appearing to be a local florist. Replace the placeholder link shape in `data/flowers.json` with the exact link from the affiliate area, and keep the wording "Send flowers" (no local-florist claim).
17. **Funeral-home florist pages:** none are listed yet. Before adding one, confirm the page is the funeral home's own (or one it names) and that linking needs no agreement (item 8).

## Ads PR 4.3.1: "Send flowers" shown without an affiliate ID (Advertising Policy §8, Privacy §3)
- With no florist page and no affiliate ID, the link now goes to a flower-delivery service's public funeral-flowers page (`data/flowers.json` `fallbackUrl`), with no affiliate code, no "paid link" label and rel="noopener nofollow". Emptying `fallbackUrl` hides it again.
- **Advertising §8:** "If neither applies, the obituary shows no link" is replaced by: the link goes to the funeral home's florist page or otherwise to an online flower-delivery service; when marked "paid link" it's an affiliate link and may earn a commission; without that label it earns us nothing.
- **Privacy §3:** a link not marked "paid link" isn't an affiliate link and carries no code at all.

### Needs review (ads PR 4.3.1)
18. **An unpaid link to one commercial florist:** a plain link to one service on every obituary, before any agreement with it. Confirm Sam is comfortable sending readers there unpaid, and that the policy wording ("an online flower-delivery service", unnamed) is enough until the service is named (item 15).

## Ads PR 4.2: advertiser lead statuses (Privacy §2 table, Advertising Policy §7)
- **Privacy, advertising inquiries row:** adds the optional package and budget, and our own status (new, contacted, proposal sent, won, lost or spam), notes and change record; purpose "to answer you and keep track of where we are with your inquiry"; retention: status, notes and change record 400 days after the last change, change log the latest 1,000 changes.
- **Advertising §7:** an inquiry marked as spam doesn't count as an upload reference.

### Needs review (ads PR 4.2)
19. **Notes about people:** admin notes are free text about a business contact. Keep them factual; confirm the 400-day retention, and whether won leads should move to a longer business record instead (they then become customers; see item 9 on order records).
20. **Spam marking:** marking an inquiry spam blocks its upload reference but doesn't delete it; it ages out of the 300-inquiry list like any other. Confirm that's enough or whether spam should be deleted sooner.

## Ads PR 5.1/5.2: campaigns, caps and rotation (Advertising Policy §2 and §3, Privacy §2)
- **Advertising §2:** each paid spot runs for the agreed dates; fixed shares per spot so it can't be oversold (3 card and 3 sponsor-line shares per board, 2 per side ad).
- **Advertising §3 and Privacy "Ads":** "turns by the date" becomes equal 15-minute turns by the clock, the same for every reader at the same moment.

### Needs review (ads PR 5.1/5.2)
21. **Caps as a promise:** the share counts are now in the policy and enforced in code. They come from the packages plan's open question 4; confirm them with Sam before selling.
22. **Share of voice wording:** with 15-minute turns, a sponsor sharing a spot with two others is shown about a third of the time. Make sure package descriptions and invoices say "a share of the spot in rotation", not "always shown".

## Ads PR 5.3: cookie-free ad counts (Privacy "Ads" and §2 table, Advertising Policy §3)
- **Privacy "Ads":** paid ads are counted in daily totals per campaign and spot: a view (at least half on screen, once per page load) or a click sends only the campaign and the spot. No cookie, ID, page address or anything about the reader.
- **Privacy §2 table (IP address):** for ad counts we keep only a one-way hash of the address and the date, for 24 hours, to stop one connection inflating the counts (600 events a day).
- **Advertising §3:** what we report to advertisers is these counts; ad blockers, some browsers and obvious bots aren't counted, and we don't estimate reach or audiences.

### Needs review (ads PR 5.3)
23. **Hashed address:** the code is an HMAC of the address and the date keyed by a server secret (`ADSTATS_SECRET`, else derived from `LISTINGS_ADMIN_KEY`/`CRON_SECRET`), so it can't be reversed by trying every address without the secret. Still treat it as personal data kept for 24 hours (that's how the table words it); confirm this is fine under the states' privacy laws we follow.
24. **Quoting counts:** only quote measured counts from the admin report or its CSV, labeled "views" and "clicks on Tri-State News pages". Don't turn them into "readers", "reach" or "impressions served" without saying how they were measured.
