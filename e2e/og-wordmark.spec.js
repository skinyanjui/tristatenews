// ship107: the TRISTATE + red NOW wordmark in light and dark (home and Legal), its fit at 320px (on phones the home
// header shows the icon instead, still named by the wordmark), and the shared social
// image tags as served. TSN_SHOTS=<dir> also saves screenshots of the header in each state.
const { test, expect } = require('@playwright/test');
const path = require('path');

const IMG = 'https://www.tristatenow.com/og-image.jpg';
const COLORS = { light: ['rgb(0, 0, 0)', 'rgb(232, 1, 1)'], dark: ['rgb(255, 255, 255)', 'rgb(255, 43, 43)'] };

async function open(page, url, theme, width) {
  await page.addInitScript(t => localStorage.setItem('tsn.theme', t), theme);
  await page.setViewportSize({ width, height: 800 });
  await page.goto(url);
}

async function shot(page, name, selector) {
  if (!process.env.TSN_SHOTS) return;
  await page.locator(selector).screenshot({ path: path.join(process.env.TSN_SHOTS, name + '.png') });
}

for (const theme of ['light', 'dark']) {
  for (const width of [320, 1280]) {
    test(`home ${theme} at ${width}px: TRISTATE + red NOW, named link, nothing overflows`, async ({ page }) => {
      await open(page, '/', theme, width);
      const link = page.getByRole('link', { name: 'TRISTATENOW home' });
      await expect(link).toHaveText('TRISTATENOW');
      const c = await page.evaluate(() => {
        const a = document.querySelector('a.brand'), n = a.querySelector('.brand-now'), r = a.getBoundingClientRect(), nav = document.querySelector('.nav-in');
        return { tri: getComputedStyle(a).color, now: getComputedStyle(n).color, bg: getComputedStyle(document.body).backgroundColor,
          fits: r.left >= 0 && r.right <= innerWidth, oneLine: innerWidth < 640 ? r.width === 44 && r.height === 44 : r.height <= 32, // phones: the 44px icon link (e2e/mobile-logo.spec.js)
          over: [nav.scrollWidth - nav.clientWidth, document.documentElement.scrollWidth - innerWidth] };
      });
      expect([c.tri, c.now]).toEqual(COLORS[theme]);
      expect(c.bg).toBe(theme === 'dark' ? 'rgb(10, 10, 10)' : 'rgb(255, 255, 255)');
      expect(c.fits && c.oneLine).toBe(true);
      expect(c.over).toEqual([0, 0]);
      await shot(page, `wordmark-home-${theme}-${width}`, '.nav-in');
    });
  }
  test(`legal ${theme} at 320px: the same wordmark colors`, async ({ page }) => {
    await open(page, '/legal', theme, 320);
    const c = await page.evaluate(() => { const a = document.querySelector('a.lg-brand'); return [getComputedStyle(a).color, getComputedStyle(a.querySelector('.brand-now')).color, a.textContent, document.documentElement.scrollWidth - innerWidth]; });
    expect(c).toEqual([...COLORS[theme], 'TRISTATENOW', 0]);
    await shot(page, `wordmark-legal-${theme}-320`, '.lg-top');
  });
}

test('served heads point Open Graph and X at og-image.jpg, which is a 1200x630 JPEG', async ({ request }) => {
  for (const p of ['/', '/events', '/classifieds', '/legal', '/newsletter', '/advertise']) {
    const h = await (await request.get(p)).text();
    for (const t of [`<meta property="og:image" content="${IMG}" />`, '<meta property="og:image:type" content="image/jpeg">', '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">', '<meta name="twitter:card" content="summary_large_image" />', `<meta name="twitter:image" content="${IMG}" />`])
      expect(h, p).toContain(t);
    expect(h, p).not.toContain('/og.png');
  }
  const img = await request.get('/og-image.jpg');
  expect(img.status()).toBe(200);
  expect(img.headers()['content-type']).toMatch(/^image\/jpeg/);
  const b = await img.body();
  expect([b[0], b[1]]).toEqual([0xff, 0xd8]);
});
