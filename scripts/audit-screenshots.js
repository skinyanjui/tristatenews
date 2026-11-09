#!/usr/bin/env node
// Capture before (live) and after (local) screenshots for the ship122 audit PR.
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ART = '/opt/cursor/artifacts';
fs.mkdirSync(ART, { recursive: true });
const LOCAL = process.env.TSN_BASE || 'http://127.0.0.1:3077';
const LIVE = 'https://www.tristatenow.com';

async function shot(page, name) {
  const file = path.join(ART, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log('wrote', file);
}

async function visit(browser, url, theme, width, height, name) {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: theme === 'dark' ? 'dark' : 'light'
  });
  const page = await context.newPage();
  await page.addInitScript(t => {
    try { localStorage.setItem('tsn.theme', t); } catch (e) {}
  }, theme);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  await shot(page, name);
  await context.close();
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--no-sandbox']
  });
  // Before: live site
  await visit(browser, LIVE, 'light', 390, 844, 'before-news-390-light.png');
  await visit(browser, LIVE, 'light', 1280, 800, 'before-news-1280-light.png');
  await visit(browser, LIVE, 'dark', 390, 844, 'before-news-390-dark.png');
  await visit(browser, LIVE, 'dark', 1280, 800, 'before-news-1280-dark.png');
  // After: local
  await visit(browser, LOCAL, 'light', 390, 844, 'after-news-390-light.png');
  await visit(browser, LOCAL, 'light', 1280, 800, 'after-news-1280-light.png');
  await visit(browser, LOCAL, 'dark', 390, 844, 'after-news-390-dark.png');
  await visit(browser, LOCAL, 'dark', 1280, 800, 'after-news-1280-dark.png');
  await visit(browser, LOCAL + '/jobs', 'light', 390, 844, 'after-jobs-empty-390-light.png');
  await visit(browser, LOCAL + '/jobs', 'light', 1280, 800, 'after-jobs-empty-1280-light.png');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
