#!/usr/bin/env node
// The site icon: the T in a circle with a red line above it (the mobile home logo, data/pages/index.html, is the same
// artwork). Writes public/favicon.svg, favicon.ico (16, 32, 48), apple-touch-icon.png (180), icon-192.png,
// icon-512.png and icon-maskable-512.png. Run by hand after changing the artwork: it renders through Chrome with
// Playwright, which isn't a dependency of the site:
//   NODE_PATH=<dir with playwright> CHROME_PATH=<chrome> node scripts/build-icons.js
// The 16, 32 and 48 pixel ICO frames are drawn on their own pixel grid so the red line stays one or two whole pixels.
'use strict';
const fs = require('fs');
const path = require('path');
const PUB = path.join(__dirname, '..', 'public');

const INK = '#111', PAPER = '#fff', RED = '#e80101', RED_ON_DARK = '#ff2b2b';
// 64-unit artwork: the circle, the red line, the T (the T of the earlier square icon, moved down to sit centred).
const ART = { accent: 'M18 14h28v4H18z', t: 'M18 22h28v7H36v19h-8V29H18z' };
const GRID = {
  16: { accent: 'M5 3h6v1H5z', t: 'M4 5h8v2H9v5H7V7H4z' },
  32: { accent: 'M9 7h14v2H9z', t: 'M9 11h14v4h-5v10h-4V15H9z' },
  48: { accent: 'M15 9h18v3H15z', t: 'M12 15h24v6h-9v15h-6V21H12z' }
};
const mark = (size, shapes, { bg = INK, fg = PAPER, red = RED } = {}) => {
  const r = size / 2, crisp = size <= 48 ? ' shape-rendering="crispEdges"' : '';
  return '<circle cx="' + r + '" cy="' + r + '" r="' + r + '" fill="' + bg + '"/><path d="' + shapes.accent + '" fill="' + red + '"' + crisp + '/><path d="' + shapes.t + '" fill="' + fg + '"' + crisp + '/>';
};
// The browser-tab icon follows the colour scheme: a dark circle on light tabs, a white one on dark tabs.
const FAVICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><style>.c{fill:' + INK + '}.a{fill:' + RED + '}.t{fill:' + PAPER + '}' +
  '@media (prefers-color-scheme:dark){.c{fill:' + PAPER + '}.t{fill:' + INK + '}}</style>' +
  '<circle class="c" cx="32" cy="32" r="32"/><path class="a" d="' + ART.accent + '"/><path class="t" d="' + ART.t + '"/></svg>\n';

const svg = (size, body, bg) => '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
  (bg ? '<rect width="' + size + '" height="' + size + '" fill="' + bg + '"/>' : '') + body + '</svg>';
// A square canvas with the circle scaled to `scale` of the side, centred (transparent unless `bg`).
const padded = (px, scale, bg) => { const d = px * scale, o = (px - d) / 2; return svg(px, '<g transform="translate(' + o + ' ' + o + ') scale(' + d / 64 + ')">' + mark(64, ART) + '</g>', bg); };

const PNGS = {
  'apple-touch-icon.png': [180, padded(180, 0.8, PAPER)], // opaque: iOS fills transparency with black and applies its own mask
  'icon-192.png': [192, padded(192, 1)],
  'icon-512.png': [512, padded(512, 1)],
  'icon-maskable-512.png': [512, padded(512, 0.76, PAPER)] // circle inside the 80% safe zone; the platform picks the mask shape
};
const ICO = { 16: svg(16, mark(16, GRID[16])), 32: svg(32, mark(32, GRID[32])), 48: svg(48, mark(48, GRID[48])) };

function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach(([px, b], i) => {
    const e = 6 + 16 * i;
    head[e] = px; head[e + 1] = px; head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(b.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += b.length;
  });
  return Buffer.concat([head, ...pngs.map(p => p[1])]);
}

async function main() {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const render = async (markup, px) => {
    await page.setViewportSize({ width: px, height: px });
    await page.setContent('<html><body style="margin:0;background:transparent">' + markup + '</body></html>');
    return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: px, height: px } });
  };
  fs.writeFileSync(path.join(PUB, 'favicon.svg'), FAVICON);
  for (const [f, [px, m]] of Object.entries(PNGS)) fs.writeFileSync(path.join(PUB, f), await render(m, px));
  const sizes = [];
  for (const px of [16, 32, 48]) sizes.push([px, await render(ICO[px], px)]);
  fs.writeFileSync(path.join(PUB, 'favicon.ico'), ico(sizes));
  await browser.close();
}

module.exports = { ART, GRID, FAVICON, PNGS, INK, PAPER, RED, RED_ON_DARK };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
