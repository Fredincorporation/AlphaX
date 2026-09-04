// Verify AlphaX works with Chrome's WebMCP testing flag enabled.
// Launches Chromium with the flag, loads the app, and exercises the
// modelContext API end-to-end. Defaults to the deployed Vercel frontend;
// set TARGET_URL to override (e.g. http://localhost:5173 for local dev).
import { createRequire } from 'node:module';
import { readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TARGET_URL = process.env.TARGET_URL || 'https://alphax-chi.vercel.app/';

function resolveChromium() {
  const bases = [
    join(homedir(), '.vscode/extensions'),
    join(homedir(), '.vscode-server/extensions'),
  ];
  for (const base of bases) {
    if (!existsSync(base)) continue;
    const dirs = readdirSync(base).filter((d) => d.startsWith('danielsanmedium.dscodegpt-')).sort().reverse();
    if (dirs[0]) {
      try {
        const mod = createRequire(join(base, dirs[0], 'standalone', 'node_modules'))('patchright');
        const chromium = mod?.chromium ?? mod?.default?.chromium;
        if (chromium) return chromium;
      } catch { }
    }
  }
  throw new Error('patchright not found');
}

const chromium = resolveChromium();
const flagVariants = [
  ['--enable-features=WebMCPTesting'],
  ['--enable-features=WebMCP'],
  ['--enable-webmcp-testing'],
];

for (const extra of flagVariants) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1228', 'chrome-win64', 'chrome.exe'),
    args: ['--no-sandbox', ...extra],
  });
  const page = await browser.newPage();
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  const result = await page.evaluate(async () => {
    const out = {};
    out.nativeNavigator = typeof navigator.modelContext;
    out.nativeDocument = typeof document.modelContext;
    out.nativeWindow = typeof window.modelContext;
    out.nativeRegisterTool = typeof navigator.modelContext?.registerTool;
    out.nativeGetTools = typeof document.modelContext?.getTools;
    // Chrome's WebMCP runtime lives on navigator.modelContext
    const mc = navigator.modelContext ?? window.modelContext ?? document.modelContext;
    try {
      await mc.registerTool({
        name: 'alphax_probe_tool',
        description: 'probe',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        execute: async ({ q }) => `echo:${q}`,
      });
      out.probeRegister = 'ok';
    } catch (e) {
      out.probeRegister = `error: ${String(e).slice(0, 200)}`;
    }
    try {
      const tools = await (mc.getTools ? mc.getTools() : navigator.modelContext.getRegisteredTools?.() ?? []);
      out.probeGetTools = (tools || []).map((t) => t.name);
    } catch (e) {
      out.probeGetTools = `error: ${String(e).slice(0, 200)}`;
    }
    // What did AlphaX's bridge register?
    out.bridgeRegistered = (window.__alphaxWebMCPProbe?.() ?? null);
    out.consoleDetected = window.__alphaxNativeDetected ?? null;
    return out;
  });

  console.log(`\n=== flags: ${extra.join(' ')} | target: ${TARGET_URL} ===`);
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}
