// Browser checks that need a running local server (not part of `npm test`). Run against a local server only:
//   PORT=3077 node server.js   (with KV/Redis env vars unset)
//   TSN_BASE=http://127.0.0.1:3077 npx playwright test -c e2e/playwright.config.js
// CHROME_PATH may point at a system Chrome when Playwright's own browser is not installed.
module.exports = {
  testDir: __dirname,
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: process.env.TSN_BASE || 'http://127.0.0.1:3077',
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : {}
  }
};
