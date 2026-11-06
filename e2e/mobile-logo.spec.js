// ship109: on phones the home header shows the circular T icon (red line above the T) instead of the wordmark, and
// the time sits under the borderless temperature; from 640px the header is as before. The site icons are the same
// artwork. Weather and the clock are fixtures and every request that leaves the local server is aborted, so nothing
// reaches a third party. TSN_SHOTS=<dir> saves header screenshots.
const { test, expect } = require('@playwright/test');
const path = require('path');

const NOW = new Date('2026-11-06T21:14:00Z'); // 3:14 PM in Evansville
const days = ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10'];
const WX = { current: { temperature_2m: 52.4, apparent_temperature: 49.8, weather_code: 2, wind_speed_10m: 6.1 },
  daily: { time: days, weather_code: [2, 3, 61, 0, 1], temperature_2m_max: [58, 55, 50, 54, 57], temperature_2m_min: [41, 43, 39, 36, 38], precipitation_probability_max: [5, 20, 70, 0, 10] } };
const RED = { light: 'rgb(232, 1, 1)', dark: 'rgb(255, 43, 43)' };

async function open(page, baseURL, { theme, scheme, width }) {
  await page.clock.setFixedTime(NOW);
  if (theme) await page.addInitScript(t => localStorage.setItem('tsn.theme', t), theme);
  if (scheme) await page.emulateMedia({ colorScheme: scheme });
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('https://api.open-meteo.com/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(WX) });
    if (u.startsWith('https://api.weather.gov/')) return route.fulfill({ contentType: 'application/geo+json', body: '{"features":[]}' });
    return u.startsWith(baseURL) ? route.continue() : route.abort();
  });
  await page.setViewportSize({ width, height: 760 });
  await page.goto('/');
  await page.locator('.wx-temp').waitFor();
}
const shot = (page, name) => process.env.TSN_SHOTS ? page.locator('header.nav').screenshot({ path: path.join(process.env.TSN_SHOTS, name + '.png') }) : null;
const measure = page => page.evaluate(() => {
  const box = s => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const a = document.getElementById('home'), card = a.querySelector('.brand-card'), btn = document.querySelector('.wx-btn'), clk = document.getElementById('clk');
  const cs = getComputedStyle(card), at = clk.getBoundingClientRect();
  return { home: box('#home'), card: box('.brand-card'), temp: box('.wx-temp'), btn: box('.wx-btn'), clk: box('#clk'), theme: box('#themeBtn'), search: box('.nav-q'), nav: box('.nav-in'),
    cardShown: cs.display !== 'none', radius: cs.borderRadius, wordSize: getComputedStyle(a).fontSize, name: a.getAttribute('aria-label'),
    accent: getComputedStyle(card.querySelector('.bc-acc')).fill, ink: getComputedStyle(card.querySelector('.bc-bg')).fill, t: getComputedStyle(card.querySelector('.bc-t')).fill,
    border: getComputedStyle(btn).borderTopWidth, hitUnderClock: document.elementFromPoint(at.left + at.width / 2, at.top + at.height / 2).closest('.wx-btn') === btn,
    clkText: clk.textContent, over: document.documentElement.scrollWidth - innerWidth, theme_: document.documentElement.getAttribute('data-theme') };
});

for (const width of [320, 390]) {
  for (const mode of [{ theme: 'light' }, { theme: 'dark' }, { scheme: 'dark' }, { scheme: 'light' }]) {
    const label = mode.theme ? mode.theme : 'system-' + mode.scheme;
    test(`phone ${width}px ${label}: circular T icon with the red line, time under the borderless temperature`, async ({ page, baseURL }) => {
      await open(page, baseURL, { ...mode, width });
      const m = await measure(page);
      const dark = (mode.theme || mode.scheme) === 'dark';
      expect(m.theme_).toBe(dark ? 'dark' : 'light');
      await expect(page.getByRole('link', { name: 'TRISTATENOW home' })).toBeVisible();
      expect(m.name).toBe('TRISTATENOW home');
      expect(m.wordSize).toBe('0px');
      expect(m.cardShown).toBe(true);
      expect(m.radius).toBe('50%');
      expect([m.home.w, m.home.h]).toEqual([44, 44]);
      expect([m.card.w, m.card.h]).toEqual([32, 32]);
      expect(m.card.l).toBe(16);
      expect(Math.abs((m.card.t + m.card.b) / 2 - (m.nav.t + m.nav.b) / 2)).toBeLessThanOrEqual(1);
      expect([m.accent, m.ink, m.t]).toEqual([RED[dark ? 'dark' : 'light'], 'rgb(17, 17, 17)', 'rgb(255, 255, 255)']);
      expect(m.border).toBe('0px');
      expect(m.clk.t).toBeGreaterThanOrEqual(m.temp.b);
      expect(Math.abs(m.clk.r - m.temp.r)).toBeLessThanOrEqual(1);
      expect(m.clk.b).toBeLessThanOrEqual(m.nav.b);
      expect(m.clkText).toContain('3:14');
      expect(m.hitUnderClock).toBe(true);
      expect(m.btn.h).toBeGreaterThanOrEqual(40);
      expect(m.clk.l).toBeGreaterThanOrEqual(m.theme.r);
      expect(m.search.l).toBeGreaterThanOrEqual(m.home.r);
      expect(m.over).toBe(0);
      await shot(page, `mobile-logo-${label}-${width}`);
    });
  }
}

for (const theme of ['light', 'dark']) {
  test(`desktop 1280px ${theme}: wordmark and clock as before, no icon`, async ({ page, baseURL }) => {
    await open(page, baseURL, { theme, width: 1280 });
    const m = await measure(page);
    expect(m.cardShown).toBe(false);
    expect(m.wordSize).toBe('15px');
    expect([m.home.l, m.home.t, m.home.r, m.home.b].map(Math.round)).toEqual([192, 8, 293, 40]);
    expect([Math.round(m.clk.l), Math.round(m.clk.t)]).toEqual([305, 14]);
    expect(m.border).toBe('1px');
    expect(m.over).toBe(0);
    await shot(page, `mobile-logo-desktop-${theme}-1280`);
  });
}

test('site icons: served with the right types, linked from the heads, listed in the manifest', async ({ page, request }) => {
  const types = { '/favicon.svg': /^image\/svg\+xml/, '/favicon.ico': /^image\/(x-icon|vnd\.microsoft\.icon)/, '/apple-touch-icon.png': /^image\/png/, '/icon-192.png': /^image\/png/,
    '/icon-512.png': /^image\/png/, '/icon-maskable-512.png': /^image\/png/, '/manifest.webmanifest': /^application\/(manifest\+json|json)/ };
  for (const [u, t] of Object.entries(types)) {
    const r = await request.get(u);
    expect(r.status(), u).toBe(200);
    expect(r.headers()['content-type'], u).toMatch(t);
  }
  const m = await (await request.get('/manifest.webmanifest')).json();
  expect(m.icons.map(i => [i.src, i.sizes, i.purpose])).toEqual([['/favicon.svg', 'any', 'any'], ['/icon-192.png', '192x192', 'any'], ['/icon-512.png', '512x512', 'any'], ['/icon-maskable-512.png', '512x512', 'maskable']]);
  for (const p of ['/', '/events', '/legal', '/newsletter', '/advertise', '/unsubscribe.html', '/order.html']) {
    const h = await (await request.get(p)).text();
    expect(h, p).toContain('<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">');
    expect(h, p).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
  }
  expect(await (await request.get('/')).text()).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
  // Decoded pixels: the tab icon follows the colour scheme; the apple-touch icon is opaque; the maskable circle sits in the safe zone.
  await page.route('**/*', r => r.request().url().startsWith('data:') || r.request().url().includes('127.0.0.1') ? r.continue() : r.abort());
  await page.goto('/legal');
  const px = (src, size, points) => page.evaluate(async ([src, size, points]) => {
    const i = new Image(); i.src = src; await i.decode();
    const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d'); x.drawImage(i, 0, 0, size, size);
    return points.map(([X, Y]) => Array.from(x.getImageData(X, Y, 1, 1).data).join(','));
  }, [src, size, points]);
  const pts = [[32, 6], [32, 16], [32, 25], [32, 40], [0, 0]];
  expect(await px('/favicon.svg', 64, pts)).toEqual(['17,17,17,255', '232,1,1,255', '255,255,255,255', '255,255,255,255', '0,0,0,0']);
  await page.emulateMedia({ colorScheme: 'dark' });
  const svg = await (await request.get('/favicon.svg')).text();
  expect(await px('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'), 64, pts)).toEqual(['255,255,255,255', '232,1,1,255', '17,17,17,255', '17,17,17,255', '0,0,0,0']);
  expect((await px('/apple-touch-icon.png', 180, [[0, 0], [90, 90]]))[0]).toBe('255,255,255,255');
  expect(await px('/icon-maskable-512.png', 512, [[256, 256 - 0.4 * 512 + 4], [256, 50]])).toEqual(['255,255,255,255', '255,255,255,255']);
  const ico = await (await request.get('/favicon.ico')).body();
  expect([ico.readUInt16LE(2), ico.readUInt16LE(4), ico[6], ico[22], ico[38]]).toEqual([1, 3, 16, 32, 48]);
});
