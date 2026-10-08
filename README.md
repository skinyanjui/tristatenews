# Tri-State News

Hourly local news from Evansville, Owensboro, Madisonville, Carbondale, Marion, Vincennes and the towns between them. Weather for Evansville sits in the top nav.

## Deploy

1. Unzip, then from this folder run `npx vercel deploy --prod` (log in when asked).
2. Open the URL Vercel prints. No build step, no dependencies.

## How it works

- `api/news.js` fetches every feed in `SOURCES`, drops AP wire copy, keeps only regional stories from wider-market stations (`geo: true`), removes duplicates, and returns one list.
- The response is cached at the edge for one hour (`s-maxage=3600`), so the feeds are re-pulled about once an hour. An open page also re-checks every hour.
- `public/index.html` is the page. Headlines open the original article in a new tab. Weather comes from Open-Meteo.
- A source that fails or returns nothing is hidden automatically.

## Add feeds without editing code

In the Vercel project, add an environment variable `EXTRA_FEEDS` containing a JSON array:

```json
[{"id":"usi","name":"USI News","area":"Evansville","kind":"institution","url":"https://example.edu/feed"},
 {"id":"vcso","name":"Vanderburgh Sheriff","area":"Evansville","kind":"police","maxAgeDays":30,"url":"https://example.org/rss"}]
```

`kind` can be `institution`, `courts` or `police`. Add `"geo": true` for outlets that cover a wider region, so only stories naming a local place are kept. Redeploy after changing it.

## Features

Search, tabs in the top nav (All, News, Police & courts, Liked), "Show more" paging, hearts with counts, a breaking news card (only when an outlet labels a story "Breaking", "Just in" or "Developing story", for up to 12 hours), light/dark toggle, a refresh button, and a weather button that changes location (nine regional towns, or search any U.S. city). Active National Weather Service alerts for the chosen location show above the headlines.

## Shared heart counts (optional)

Hearts always work for the reader and are kept in their browser (the Liked tab). To make the counts shared across all readers, add the free **Upstash for Redis** integration to the Vercel project (Storage tab, Marketplace). It sets `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, which `api/react.js` uses. Redeploy afterward. Without it, each story's count shows only your own heart (1 or nothing). One heart per browser per story; there are no accounts, so determined people can clear storage and heart again.

## How the news is fetched
A scheduled job calls `/api/refresh`, which fetches every feed, merges the stories and saves them in Redis. `/api/news` only serves that saved snapshot, so pages load instantly and never wait on a slow publisher.
- **Per-source memory:** each source keeps its last good stories (up to 80, within the age window). A failed or rate-limited fetch keeps them and marks the source `stale` in the `sources` list instead of making it vanish.
- **Conditional requests:** the ETag / Last-Modified from the last fetch is sent back, so unchanged feeds answer 304 and cost almost nothing. The URL that worked last time is tried first.
- **Two tiers:** `?tier=fast` (TV stations, daily papers, FBI and U.S. Attorney releases) every 10 minutes and `?tier=all` twice an hour.
- **Self-healing:** with no snapshot, or one older than 3 hours, the first visitor to `/api/news` triggers a refresh (guarded by a short lock). Without Redis the site works as before, fetching live when the hourly cache expires.

Setup (about five minutes):
1. Add the Upstash Redis integration in Vercel (see Shared heart counts) if you haven't.
2. Add an environment variable `CRON_SECRET` in Vercel (any long random string) and redeploy.
3. In this GitHub repo add the secrets `CRON_SECRET` (same value) and `SITE_URL` (for example `https://tristatenews.vercel.app`). The workflow in `.github/workflows/refresh-news.yml` then runs on schedule. You can also run it by hand from the Actions tab.
4. On Vercel Pro you can use Vercel Cron instead: add `"crons": [{ "path": "/api/refresh?tier=all", "schedule": "*/30 * * * *" }]` to `vercel.json`. On the Hobby plan Vercel rejects crons that run more than once a day, which is why the repo uses GitHub Actions.

Check it works: `curl -H "Authorization: Bearer $CRON_SECRET" "$SITE_URL/api/refresh?tier=all"` returns how many stories were stored, how many sources answered 304, and which sources are failing.

## Feed status (checked October 7, 2026)

Returned stories in today's run (19 of 40 sources): 14 News, Eyewitness News, Evansville Living, Owensboro Times, The Messenger (Madisonville), Daily Egyptian, Princeton Daily Clarion, KFVS12, Kentucky Lantern, WKDQ, WBKR, Owensboro Radio, WKMS, FBI Louisville, Indianapolis and Springfield, U.S. Attorney W.D. Kentucky and S.D. Illinois, and the Visit Madisonville events calendar. Messenger-Inquirer, Vincennes Sun-Commercial, Explore Evansville, Visit Owensboro and others returned stories in some runs and a rate-limit or block error in others, so they come and go.

Working feeds that showed nothing because of the regional filter (statewide or national content with no local place named): WIKY, WTHI, Indiana Capital Chronicle, Capitol News Illinois, Illinois Public Media, WSTO.

Blocked or failing from the test machine, kept in the list in case they work from Vercel: Courier & Press and Henderson Gleaner (HTTP 403), Daily Republican-Register (403), Pike County News, Murphysboro American, WEOA and WJPS (timeouts or errors), Washington Times-Herald, Dubois County Herald, WPSD and The Southern Illinoisan (429). A source that returns nothing is hidden automatically.

Not included, no working feed found: Indiana State Police, Illinois State Police, local police and sheriff departments, county courts, city and county governments, WNIN, WSIU, USI, SIU, Vincennes University, the U.S. Attorney for S.D. Indiana.

## Events tab

The **Events** tab shows event cards (date tile, name, time, place, category) with category filters. Anyone can add an event (name, category, date, optional time and place, town, details, optional organizer contact) through `/api/listings?kind=event`; events come down the day after they happen, are rate-limited, reject links and are hidden after 3 reports. Upcoming items from any calendar feed (`kind: 'events'` sources in `api/news.js`, RSS or iCal) are merged into the same list. Sample events fill the page until there are 8 real ones.

## Deals tab

Local businesses can post a deal (business, offer, category, town, optional coupon code and end date, where to find it) from the Deals tab. Deals use the same `/api/listings` endpoint and Redis store as classifieds (`kind=deal`), come down on their end date or after 30 days, reject links, are rate-limited, and are hidden after 3 reports. The page shows deal cards only (no news stories). Without Upstash configured, only the sample deals show.

## Classifieds tab

Readers can post items for sale (title, price, town, details, contact). Listings are stored in the same Upstash Redis as the heart counts, expire after 30 days, are rate-limited (3 a day per browser, 8 per IP), reject links, and are hidden after 3 reader reports. A poster can remove their own listing; set `LISTINGS_ADMIN_KEY` to remove any listing with `DELETE /api/listings?id=<id>` and an `x-admin-key` header. Without Upstash configured, the tab shows only links to other local boards. Contact details are public, so consider a short posting policy.

### Sample posts and forms

Until there are 8 real posts, the Classifieds and Deals tabs fill the list with clearly labeled **Sample** posts (fictional businesses, no real phone numbers) so the tabs never look empty. They go away as real posts come in; edit or remove `SAMPLE_ITEMS` / `SAMPLE_DEALS` in `public/index.html` to change them. Classifieds posts have a category, condition, price (or Free) and a phone or email that is checked; deals have a category, optional coupon code and end date. Both forms show inline errors, and each list has category filters.

## Photos and logos
Classifieds, Deals and Events posts can include a photo; Deals can also include a business logo. The form re-encodes uploads to JPEG in the browser (photo: 800px longest edge; logo: 96px square). `api/listings.js` accepts only real JPEG data, stores the photo under its own key and serves it at `GET /api/listings?img=<id>` (cached one day). Logos are stored inline in the post. Photos and logos are only saved when Upstash Redis is configured.
Posts without a photo show generated category art; businesses without a logo show an initials avatar. Events from feeds show their source's logo.

## Submit news page
The footer's "Submit news" button opens a submission form (type, headline, details, town, date, up to two photos, contact info, consent). `POST /api/submit` validates it, rate-limits 5 per IP per day, ignores bots via a hidden honeypot field, and delivers it by either or both of:
- **Redis:** stored in the `tsn:tips` list (latest 500). Read them with `GET /api/submit` and header `x-admin-key: <LISTINGS_ADMIN_KEY>`.
- **Email (Resend):** set `RESEND_API_KEY` and `TIPS_TO_EMAIL` (optional `TIPS_FROM_EMAIL`). Photos arrive as attachments and replies go to the submitter.
With neither configured the form says submissions aren't open yet. Edit the "Good to know" policy lines in `public/index.html` (`renderSubmit`) to match your newsroom's rules.


## Events, obituaries and banners

- **Events** come from the Ford Center and Victory Theatre listing pages (`parser: 'venue'` in `api/news.js`), plus any iCal/RSS feeds that answer. Explore Evansville, Visit Owensboro and Visit Madisonville block automated requests, so they stay hidden unless they start working.
- **Obituaries** are the papers' own obituary sections (BLOX `c=obituaries` feeds for the Messenger-Inquirer, Dubois County Herald, Princeton Daily Clarion, Sun-Commercial, The Messenger and Washington Times-Herald) and the Owensboro Times. Each card is a short excerpt that links to the full notice. They are kept for 21 days. The Courier & Press publishes through Legacy.com, which blocks automated requests, so Evansville is covered only by the other outlets.
- **Weather banner**: current conditions from Open-Meteo, alerts from the National Weather Service API (`api.weather.gov`), both called from the browser and credited in the banner.
- **Breaking banner**: shows only stories the outlet itself labels breaking (see `BREAKING_RE`), for 12 hours, with the outlet name and a link.

- **Ticketmaster events** (concerts, sports, theater within 75 miles of Evansville): set `TICKETMASTER_API_KEY` (free key from developer.ticketmaster.com) in the Vercel environment variables and redeploy. Without it the source is skipped. The key is read on the server only and never stored with the feed data or sent to the browser.

## Jobs

The Jobs tab is a community board like Classifieds and Deals: employers post openings (title, employer, industry, town, full-time/part-time/seasonal/contract, pay, how to apply by phone or email, optional logo) through `POST /api/listings` with `kind: "job"`. Jobs expire after 45 days, can be reported (hidden at 3 reports) or removed by their poster, and are searchable with the rest of the site. The tab also links to Indeed, LinkedIn, the Indiana, Kentucky and Illinois state job sites and USAJOBS. Until real postings arrive it shows clearly labeled sample jobs. Public job feeds for the area were checked and none were available without an API key or login.

## Making money

- **Featured posts (Stripe).** Posters see a "Feature" button on their own job, deal, event or listing (job $29/30 days, deal $19/14, event $15/7, item $5/7; change `PRICES` in `api/checkout.js`). Featured posts sort first with an amber "Featured" badge. Set `STRIPE_SECRET_KEY`, and in Stripe add a webhook endpoint `https://<site>/api/stripe-webhook` for `checkout.session.completed` and set `STRIPE_WEBHOOK_SECRET` to its signing secret. Optional `SITE_URL` sets where Stripe returns people. Without the secret key the button is hidden. Pricing is created inline at checkout, so no Stripe products are needed.
- **Sponsors.** Edit `public/sponsors.json`: each slot (`news`, `jobs`, `deals`, `events`, `classifieds`) takes `{ "name", "text", "url" }` (https only). An open slot on a board shows a "Your business here, Advertise" line that opens the Advertise page.
- **Advertise page.** The footer "Advertise" button opens a rate card and inquiry form (`POST /api/advertise`), stored in Redis and emailed through Resend like news tips (`RESEND_API_KEY`, `TIPS_TO_EMAIL`). Read inquiries with `GET /api/advertise` and header `x-admin-key`.
- **Newsletter.** The signup box under the news feed posts to `/api/subscribe` and keeps emails in Redis (read with `GET /api/subscribe` and `x-admin-key`). Set `RESEND_AUDIENCE_ID` (with `RESEND_API_KEY`) to also add subscribers to a Resend audience for sending broadcasts.
- **Admin page.** `/admin.html` (not indexed) takes your `LISTINGS_ADMIN_KEY` and lists newsletter subscribers (with a CSV download), advertising inquiries and news tips.
- **Google AdSense (optional).** After AdSense approves the site, set `"adsense": {"client": "ca-pub-…", "slot": "…"}` in `public/sponsors.json`. It fills the news-feed slot only while no direct sponsor holds it, so a paying sponsor always wins. AdSense also needs a privacy policy and, for EU/UK visitors, a consent banner.
