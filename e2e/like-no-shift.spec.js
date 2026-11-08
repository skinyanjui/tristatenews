// ship89: liking a post never moves the posted time and never replaces nodes, on news, obituary, search and event
// cards at 390 and 1280. The like API (/api/react) is mocked: every story starts at 9 likes so a like is 9 -> 10
// (one more digit); a story the counts call did not cover starts at 0 (0 -> 1). The mocked server answer must not cause
// a second change.
const { test, expect } = require('@playwright/test');

const now = Date.now(), pad = n => String(n).padStart(2, '0');
const chi = ms => new Date(ms).toLocaleString('en-CA', { timeZone: 'America/Chicago', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const ev = (i, title, ms) => { const [d, t] = chi(ms).split(', '); return { id: 'e2e0000' + i, title, town: 'Evansville', desc: 'A local community event.', contact: '812-555-0111', category: 'Community', date: d, time: t.replace(/^24/, '00'), place: 'Central Library', at: new Date().toISOString() }; };
const EVENTS = [ev(1, 'Evening chess club', now + 2 * 36e5), ev(2, 'Late jazz night', now + 3 * 36e5), ev(3, 'Tomorrow bake sale', now + 26 * 36e5)];

async function mock(page) {
  let posts = 0; const counts = {};
  await page.route(/\/api\/react(\?|$)/, async route => {
    const req = route.request();
    if (req.method() === 'POST') { posts++; const b = JSON.parse(req.postData() || '{}'); counts[b.id] = Math.max(0, (counts[b.id] || 0) + (b.liked ? 1 : -1)); return route.fulfill({ json: { count: counts[b.id] } }); }
    const ids = (new URL(req.url()).searchParams.get('ids') || '').split(',').filter(Boolean);
    return route.fulfill({ json: { configured: true, counts: Object.fromEntries(ids.map(id => [id, (counts[id] = 9)])) } });
  });
  await page.route(/\/api\/listings\?kind=event$/, route => route.fulfill({ json: { configured: true, items: EVENTS } }));
  return () => posts;
}

const PAGES = [
  ['news', '/', 'article.card:has(.acts .like)', 'time'],
  ['obituaries', '/obituaries', 'article.card:has(.acts .like)', 'time'],
  ['search', '/?q=evansville', 'article.card:has(.acts .like)', 'time'],
  ['events', '/events', '.evx-rail .evc:has(.evc-like)', '.evc-time']
];

for (const w of [390, 1280]) {
  for (const [name, path, cardSel, timeSel] of PAGES) {
    test(`${name} at ${w}: like / unlike moves nothing and replaces nothing`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 });
      const posts = await mock(page);
      await page.goto(path);
      // wait until the first paint and the counts paint are done, so the card found below is the final one
      await page.waitForLoadState('networkidle');
      if (name !== 'events') await page.waitForFunction(() => [...document.querySelectorAll('.acts .like span')].some(s => s.textContent === '9'));
      const card = page.locator(cardSel).first();
      await card.waitFor({ state: 'visible', timeout: 20000 });
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(800); // counts loaded (GET /api/react) and painted
      const heart = card.locator(name === 'events' ? '.evc-like' : '.acts .like');
      // news cards load the mocked 9; the event picture heart may still be at 0, so that check covers 0 -> 1
      const start = Number(await heart.locator('span').textContent()) || 0;
      const show = n => (n > 0 ? String(n) : '');
      // tag the nodes so a replacement would be detected
      await card.evaluate((c, ts) => { c.__probe = 1; c.querySelector(ts).__probe = 1; }, timeSel);
      const box = () => card.locator(timeSel).boundingBox();
      const before = await box();
      for (const [n, label] of [[show(start + 1), 'like'], [show(start), 'unlike']]) {
        await heart.click();
        await expect(heart.locator('span')).toHaveText(n);
        await page.waitForTimeout(400); // the mocked server answer has arrived
        await expect(heart.locator('span')).toHaveText(n); // no second jump from the server answer
        const after = await box();
        expect(after, `${label}: time box`).toEqual(before);
        if (name !== 'events' && name !== 'news' && name !== 'search') { const h = await heart.boundingBox(); expect(after.x + after.width, `${label}: time clear of the heart`).toBeLessThanOrEqual(h.x); }
        const same = await card.evaluate((c, ts) => c.isConnected && c.__probe === 1 && c.querySelector(ts).__probe === 1, timeSel);
        expect(same, `${label}: card and time are the same nodes`).toBe(true);
      }
      expect(posts()).toBe(2);
    });
  }
}
