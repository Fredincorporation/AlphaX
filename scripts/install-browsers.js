/**
 * Installs Playwright's Chromium browser after `npm install`.
 * Skipped on Vercel (frontend-only, no apt-get, doesn't need a browser).
 * Required on Render (backend uses Playwright for browser automation).
 */
if (process.env.VERCEL) {
  console.log('[install-browsers] Skipping Playwright install on Vercel build.');
  process.exit(0);
}

const { spawnSync } = require('child_process');
const result = spawnSync('npx playwright install --with-deps chromium', {
  stdio: 'inherit',
  shell: true,
});
process.exit(result.status ?? 1);
