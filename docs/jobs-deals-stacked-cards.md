# Jobs & Deals stacked cards (approved)

Sam t266s1414. Visual refs (hierarchy only, not assets): [Job Cards](https://dribbble.com/shots/18865814-Job-Cards), [Coupon Card UI](https://dribbble.com/shots/25893061-Scratch-Coupon-Card-UI-Light-Dark-Theme-All-States). No scratch gimmick. Site tokens: black (`--foreground`) primary CTA, red (`--red`) for Demo listing, existing light/dark.

## Card (list)

Compact stacked card, fluid height, text wraps, nothing clipped off the card or viewport. One column on phones; existing `job-grid` / `deal-grid` at 720 / 1920. Keep `.row-job` / `.row-deal`. Keep 8+8 samples and one-row 44px category strips on every board.

**Jobs:** logo + company name → role (wrap) → location · type (wrap) → pay if provided → small Demo listing note if sample → full-width ≥44px **View job**.

**Deals:** photo when present (no-image skips it) → logo + merchant → prominent offer (wrap) → conditions / town / expiry (wrap) → Demo listing note if sample → full-width ≥44px **View deal**. Coupon codes are not on the card.

Demo listing copy is separate from the CTA, 12px, readable. Samples never say “Featured · Paid”. Real paid listings still say **Featured · Paid**. Featured samples say **Sample featured placement**.

## Detail (View job / View deal)

Native `<dialog class="bd-sheet">` (same idea as `evxDetails`: Esc, backdrop click, Close, focus returns to the opener). No news story swipe.

**Sample:** heading + body from the listing; explicit “This is a demo listing. It is not a real job / offer and you cannot apply or redeem it.” No Apply, no Get offer, no Copy code. Sample jobs may offer a quiet **Advertise a job** link to `/advertise`.

**Real:** description, contact, Report / Feature when `actions()` already would. **Apply** only when `contact` is a working `mailto:` / `tel:`. **Get offer** only for the same. **Copy code** only when a real listing has `code`. No fake redemption.

## Out of scope

Header, news/classifieds/events/obits cards, data model, API functions, Superdesign, Stripe, Redis writes, crawl/refresh, secrets.
