# News feed cards + article preview sheet (approved)

Sam: build the attached light/dark concept on the site. Visual refs are design concepts with **example content** (publisher, stories, photo, reaction counts are placeholders — not real news). Use the live feed. Do not scrape full articles.

Header, tabs, weather, and search stay as they are (the mock header is an approximation). Jobs, Deals, Events, Classifieds, and Obituaries boards stay as shipped.

## Feed card (news stories only)

Photo-led stacked `article.card.news-story` where `makeCard` draws a non-Breaking news / police / courts / institution story (home, News, town/county, search). Not `UI.row`.

1. Publisher logo + name and timestamp at the **top**
2. Full-width photo when the story may show one (16:9, cover). Police & courts and crime-title mugshot suppression unchanged. Missing photo or load error: compact text card, no empty box, no broken image
3. Real section kicker only when `sectionLabel` adds information (Sports, Police & courts, …). Never “EXAMPLE STORY”
4. Bold headline, wrap, 2–3 lines on phones
5. Two-line summary (existing `DD.preview` / 220-char feed blurb — a preview, not a republish)
6. Stable bottom row: existing **heart** and **share** only, ≥44px. No comment, bookmark, or fake “—” counters. Real like counts stay if the heart already shows them

Modest 16px corners. Light: white / light gray / black. Dark: charcoal. Red only for real kickers and the sheet Continue.

Breaking cards keep the existing lead layout. In-feed house/sample ads stay labeled Sponsored / Sample ad; News stays one column (`.news-one`) with card gap so ads fit beside the taller cards. External ad-network sizes unchanged.

## Preview sheet

Expand existing `storySheet` (`dialog.st-sheet`): overlay-dimmed feed, grab handle on phones, Close, Esc, backdrop click, `html.st-open` scroll lock, internal scroll for a long summary, focus returns to the card.

Order: publisher identity → larger photo (same photo rules as the card) → headline → **full-contrast** short summary (`it.more` or `it.summary`, never fetched from the article) → heart + share (same calls as the card) → full-width **red** Continue to `{publisher}` with the outlet logo when we have one → “Opens … in a new tab.”

Preserve swipe, arrows, Previous/Next, and end resistance. Continue opens `it.link` in a new tab. A reaction click must not navigate.

## Mock vs site (do not invent)

| Mock | Site |
| --- | --- |
| Example weather / “All Local Sports…” chips / illustration | Real header, tabs, weather, feed photos |
| “EXAMPLE STORY”, fake publisher, fake counts | Real labels, sources, times, like counts |
| Comment and bookmark | Not built — omitted |
| “Continue to publisher” | Keep “Continue to {source}” + logo |

## Out of scope

Data model, `/api/news` refresh/cache, auth, payments, privacy, Redis writes, crawl, secrets, Superdesign, new services. No Jobs/Deals/header redesign.
