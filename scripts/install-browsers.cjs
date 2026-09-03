/**
 * Installs Playwright's Chromium browser after `npm install`.
 * Skipped on Vercel (frontend-only, no browser is needed).
 * Installs only the browser by default because hosted build environments may
 * not allow the privileged package-manager step used by --with-deps.
 * The local browser path keeps the binary with node_modules for deployment.
 * Set PLAYWRIGHT_INSTALL_DEPS=true when system dependencies can be installed.
 * Note: .cjs extension because package.json uses "type": "module".
 */
if (process.env.VERCEL) {
  console.log('[install-browsers] Skipping Playwright install on Vercel build.');
  process.exit(0);
}

const { spawnSync } = require('child_process');
const installDeps = process.env.PLAYWRIGHT_INSTALL_DEPS === 'true';
const command = installDeps
  ? 'npx playwright install --with-deps chromium'
  : 'npx playwright install chromium';

console.log(`[install-browsers] Running: ${command}`);
const result = spawnSync(command, {
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0' },
  stdio: 'inherit',
  shell: true,
});
process.exit(result.status ?? 1);
