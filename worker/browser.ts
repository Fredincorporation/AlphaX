import puppeteer, { type Browser, type ElementHandle, type Page } from '@cloudflare/puppeteer';
import type { ActionStep, WebMCPToolDefinition } from '../shared/types';
import type { Env } from './env';

const ACTION_TIMEOUT = 8000;

/**
 * Force the English (en-US) version of every site the automation browser visits.
 *
 * Sites pick their language from (in rough order of influence):
 *  1. URL params (`hl=`, `?lang=`, `setlang=`) — handled by `withEnglishUrlParams`
 *  2. Accept-Language HTTP header
 *  3. `navigator.language(s)` (client-side scripts like Google's)
 *  4. Cookies (e.g. Google's NID/SPORTS prefs, Wikipedia's language subdomain)
 *
 * This helper pins 2 and 3 to en-US so every page render and client-side
 * redirect lands on English content.
 */
async function configureEnglishLocale(page: Page): Promise<void> {
  // 2. Every outgoing request advertises English (US) as the preferred language.
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
  });

  // 3. Patch navigator.language(s) and Intl defaults before any site script runs,
  //    so language-detection JS (Google, Yahoo, etc.) sees an English browser.
  await page.evaluateOnNewDocument(() => {
    try {
      Object.defineProperty(navigator, 'language', { get: () => 'en-US', configurable: true });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'], configurable: true });
      const OriginalDateTimeFormat = Intl.DateTimeFormat;
      Object.defineProperty(Intl, 'DateTimeFormat', {
        value: class extends OriginalDateTimeFormat {
          constructor(...args: unknown[]) {
            if (args.length === 0 || args[0] === undefined) args[0] = 'en-US';
            super(...(args as ConstructorParameters<typeof OriginalDateTimeFormat>));
          }
          resolvedOptions() {
            const options = super.resolvedOptions();
            if (!options.locale || options.locale === 'und') options.locale = 'en-US';
            return options;
          }
        },
        writable: true,
        configurable: true,
      });
    } catch {
      // Best-effort: some pages may seal these objects.
    }
  });
}

/** Rewrite a URL to include site-specific English-forcing parameters. */
function withEnglishUrlParams(url: string): string {
  try {
    const parsed = new URL(url);
    if (/google\./i.test(parsed.hostname)) {
      parsed.searchParams.set('hl', 'en');
      if (parsed.pathname === '/' || parsed.pathname === '/search') parsed.searchParams.set('gl', 'us');
    }
    if (/yahoo\./i.test(parsed.hostname)) parsed.searchParams.set('lang', 'en-US');
    if (/wikipedia\.org$/i.test(parsed.hostname) && !parsed.hostname.startsWith('en.')) {
      parsed.hostname = `en.${parsed.hostname}`;
    }
    if (/bing\./i.test(parsed.hostname)) {
      parsed.searchParams.set('setlang', 'en');
      parsed.searchParams.set('cc', 'US');
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function visibleTarget(page: Page, selector: string, editable = false, timeoutMs = ACTION_TIMEOUT): Promise<ElementHandle<Element>> {
  const deadline = Date.now() + timeoutMs;
  // Support comma-separated or array fallback candidates
  const selectorCandidates = selector.split(',').map((s) => s.trim()).filter(Boolean);

  while (Date.now() < deadline) {
    for (const candSelector of selectorCandidates) {
      try {
        const elements = await page.$$(candSelector);
        for (const candidate of elements) {
          const usable = await candidate.evaluate((element, requireEditable) => {
            const htmlElement = element as HTMLElement & { disabled?: boolean };
            const style = window.getComputedStyle(htmlElement);
            const rect = htmlElement.getBoundingClientRect();
            const visible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
            const isEditable = element instanceof HTMLTextAreaElement
              || (element instanceof HTMLInputElement && !['button', 'hidden', 'image', 'reset', 'submit'].includes(element.type))
              || element instanceof HTMLSelectElement;
            return visible && (!requireEditable || isEditable) && !htmlElement.disabled;
          }, editable);
          if (usable) return candidate;
          await candidate.dispose();
        }
      } catch {
        // Continue to next candidate selector
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for a ${editable ? 'visible editable' : 'visible'} element matching "${selector}".`);
}

function resolveSelector(selector: string, tool: WebMCPToolDefinition, stepType: ActionStep['type']): string {
  const isGoogleSearch = /google\./i.test(`${tool.domain} ${tool.annotations.sourceUrl || ''}`)
    && /search/i.test(`${tool.name} ${tool.description}`)
    && stepType === 'fill';
  if (isGoogleSearch && /(?:^|\[)name=['"]?btnK['"]?/i.test(selector)) {
    return 'textarea[name="q"], input[name="q"]';
  }

  // Bing search results fallback
  if (/#b_results\b/i.test(selector)) {
    return '#b_results, #b_content, ol#b_results, .b_algo, main, [role="main"]';
  }

  // News card heading fallback
  if (/\.news-card\s+h2/i.test(selector)) {
    return '.news-card h2, article h2, [class*="card"] h2, [class*="story"] h2, [class*="news"] h2, main h2, h2';
  }

  // Generic news card fallback
  if (/\.news-card\b/i.test(selector)) {
    return '.news-card, article, [class*="card"], [class*="story"], [class*="news"], main li';
  }

  return selector;
}

async function waitForNavigation(page: Page, action: () => Promise<void>): Promise<void> {
  await Promise.allSettled([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
    action(),
  ]);
}

async function runStep(page: Page, step: ActionStep, tool: WebMCPToolDefinition, value: string): Promise<unknown> {
  const selector = step.selector ? resolveSelector(step.selector, tool, step.type) : undefined;
  switch (step.type) {
    case 'navigate':
      if (!step.url) throw new Error('Navigation step is missing a URL.');
      await page.goto(withEnglishUrlParams(step.url), { waitUntil: 'domcontentloaded', timeout: 25000 });
      return null;
    case 'fill':
    case 'type': {
      if (!selector) throw new Error('Fill step is missing a selector.');
      const target = await visibleTarget(page, selector, true, step.timeoutMs || ACTION_TIMEOUT);
      await target.evaluate((element, text) => {
        const input = element as HTMLInputElement | HTMLTextAreaElement;
        input.focus();
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
      await target.dispose();
      return null;
    }
    case 'click': {
      if (!selector) throw new Error('Click step is missing a selector.');
      const action = async () => {
        const target = await visibleTarget(page, selector, false, step.timeoutMs || ACTION_TIMEOUT);
        await target.click();
        await target.dispose();
      };
      if (step.waitForNavigation) await waitForNavigation(page, action);
      else await action();
      return null;
    }
    case 'press': {
      const action = async () => {
        if (selector) {
          const target = await visibleTarget(page, selector, false, step.timeoutMs || ACTION_TIMEOUT);
          await target.press((step.key || value || 'Enter') as any);
          await target.dispose();
        } else {
          await page.keyboard.press((step.key || value || 'Enter') as any);
        }
      };
      if (step.waitForNavigation) await waitForNavigation(page, action);
      else await action();
      return null;
    }
    case 'select': {
      if (!selector) throw new Error('Select step is missing a selector.');
      const target = await visibleTarget(page, selector, false, step.timeoutMs || ACTION_TIMEOUT);
      await target.select(value);
      await target.dispose();
      return null;
    }
    case 'check':
    case 'uncheck': {
      if (!selector) throw new Error(`${step.type} step is missing a selector.`);
      const target = await visibleTarget(page, selector, false, step.timeoutMs || ACTION_TIMEOUT);
      await target.evaluate((element, type) => {
        const input = element as HTMLInputElement;
        if (input.checked !== (type === 'check')) input.click();
      }, step.type);
      await target.dispose();
      return null;
    }
    case 'hover': {
      if (!selector) throw new Error('Hover step is missing a selector.');
      const target = await visibleTarget(page, selector, false, step.timeoutMs || ACTION_TIMEOUT);
      await target.hover();
      await target.dispose();
      return null;
    }
    case 'wait_for':
      if (selector) {
        try {
          const target = await visibleTarget(page, selector, false, step.timeoutMs || 4000);
          await target.dispose();
        } catch (waitErr) {
          // If the step is explicitly optional, or if a general timeout occurs on a search container, gracefully continue
          if (step.optional) {
            return null;
          }
          // For search result containers like #b_results, if the page has already loaded results under main or body, continue
          const hasContent = await page.evaluate(() => document.body && document.body.innerText.trim().length > 100);
          if (!hasContent) {
            throw waitErr;
          }
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, step.timeoutMs || 1000));
      }
      return null;
    case 'scroll':
      await page.evaluate(() => window.scrollBy({ top: 500, behavior: 'smooth' }));
      return null;
    case 'extract_text': {
      // Resilient text extraction: query selector with fallback to article, main, or body instead of throwing
      const targetSelector = selector || 'body';
      const text = await page.evaluate((sel) => {
        // Try candidate selectors separated by comma or fallback to general content containers
        const candidates = sel ? sel.split(',').map((s) => s.trim()).filter(Boolean) : [];
        for (const candidate of candidates) {
          try {
            const el = document.querySelector(candidate);
            if (el && (el as HTMLElement).innerText?.trim()) {
              return (el as HTMLElement).innerText;
            }
          } catch {
            // ignore invalid syntax
          }
        }
        // Fallback to article, main, or body
        const fallback = document.querySelector('article')
          || document.querySelector('main')
          || document.querySelector('[role="main"]')
          || document.body;
        return (fallback as HTMLElement)?.innerText || fallback?.textContent || '';
      }, targetSelector);

      return { text: text.trim().slice(0, 5000), characterCount: text.length };
    }
    case 'extract_links': {
      const targetSelector = selector || 'a';
      const links = await page.evaluate((sel) => {
        const candidates = sel ? sel.split(',').map((s) => s.trim()).filter(Boolean) : ['a'];
        let matchedElements: Element[] = [];
        for (const candidate of candidates) {
          try {
            const els = Array.from(document.querySelectorAll(candidate));
            if (els.length > 0) {
              matchedElements = els;
              break;
            }
          } catch {
            // ignore
          }
        }
        if (matchedElements.length === 0) {
          matchedElements = Array.from(document.querySelectorAll('a'));
        }
        return matchedElements
          .map((element) => {
            const anchor = element.tagName.toLowerCase() === 'a' ? element as HTMLAnchorElement : element.querySelector('a');
            return {
              text: (element as HTMLElement).innerText?.trim() || anchor?.innerText?.trim() || '',
              href: anchor?.href || '',
            };
          })
          .filter((link) => link.text && link.href)
          .slice(0, 30);
      }, targetSelector);

      return { links, count: links.length };
    }
    case 'evaluate_js':
      return page.evaluate((code) => (0, eval)(code), value);
    case 'screenshot':
      return { screenshotBase64: toBase64(await page.screenshot({ type: 'jpeg', quality: 65 })) };
    default:
      throw new Error(`Action type "${step.type}" is not supported by the Cloudflare backend yet.`);
  }
}

const LAUNCH_ATTEMPTS = 3;
const LAUNCH_BACKOFF_MS = [2000, 6000, 12000];

/**
 * Launch a browser with retry/backoff. Cloudflare Browser Rendering returns
 * 429 "Rate limit exceeded" when concurrent or daily quotas are hit; retrying
 * after a delay usually succeeds once other sessions have been released.
 */
async function launchBrowser(env: Env): Promise<Browser> {
  let lastError: unknown;
  for (let attempt = 0; attempt < LAUNCH_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, LAUNCH_BACKOFF_MS[Math.min(attempt - 1, LAUNCH_BACKOFF_MS.length - 1)]));
    }
    try {
      return await puppeteer.launch(env.BROWSER);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/429|rate limit/i.test(message)) throw error;
    }
  }
  throw new Error(
    'Browser Rendering rate limit exceeded (HTTP 429). Cloudflare allows a limited number of concurrent browser sessions (2 on the free plan) and a daily request quota. Retried multiple times with backoff — please wait a moment and try again, or reduce the frequency of tool executions.',
  );
}

export async function executeRecipe(env: Env, tool: WebMCPToolDefinition, parameters: Record<string, unknown>, onStep?: (message: string) => Promise<void>): Promise<{ result: unknown; screenshotBase64?: string }> {
  const browser: Browser = await launchBrowser(env);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await configureEnglishLocale(page);
    let result: unknown = null;
    let screenshotBase64: string | undefined;
    for (const step of tool.actionRecipe) {
      const value = step.dynamicParam && parameters[step.dynamicParam] !== undefined
        ? String(parameters[step.dynamicParam])
        : String(step.value || step.text || '');
      await onStep?.(`Running ${step.type}${step.selector ? ` on ${step.selector}` : ''}`);
      const stepResult = await runStep(page, step, tool, value);
      if (stepResult && typeof stepResult === 'object' && 'screenshotBase64' in stepResult) {
        screenshotBase64 = (stepResult as { screenshotBase64: string }).screenshotBase64;
      } else if (stepResult !== null) {
        result = stepResult;
      }
    }
    if (!screenshotBase64) screenshotBase64 = toBase64(await page.screenshot({ type: 'jpeg', quality: 65 }));
    return { result, screenshotBase64 };
  } finally {
    await browser.close();
  }
}

export async function analyzePage(env: Env, url: string): Promise<Record<string, unknown>> {
  const browser: Browser = await launchBrowser(env);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await configureEnglishLocale(page);
    await page.goto(withEnglishUrlParams(url), { waitUntil: 'domcontentloaded', timeout: 25000 });
    const data = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      interactiveElements: Array.from(document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="searchbox"]')).slice(0, 100).map((element, index) => {
        const htmlElement = element as HTMLElement & { disabled?: boolean; type?: string; name?: string; placeholder?: string; value?: string };
        const selector = htmlElement.id ? `#${CSS.escape(htmlElement.id)}` : htmlElement.name ? `${htmlElement.tagName.toLowerCase()}[name="${CSS.escape(htmlElement.name)}"]` : htmlElement.tagName.toLowerCase();
        const rect = htmlElement.getBoundingClientRect();
        const style = window.getComputedStyle(htmlElement);
        return {
          id: `elem_${index}`,
          tagName: htmlElement.tagName.toLowerCase(),
          type: htmlElement.type,
          name: htmlElement.name,
          placeholder: htmlElement.placeholder,
          ariaLabel: htmlElement.getAttribute('aria-label') || undefined,
          selector,
          isVisible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
          isEnabled: !htmlElement.disabled,
          isInteractive: true,
        };
      }),
      forms: Array.from(document.forms).map((form, index) => ({
        id: form.id || `form_${index}`,
        action: form.action,
        method: form.method || 'GET',
        fields: Array.from(form.querySelectorAll('input, select, textarea')).filter((element) => (element as HTMLInputElement).type !== 'hidden').map((element) => {
          const input = element as HTMLInputElement;
          return { name: input.name || input.id, type: input.type || 'text', label: input.getAttribute('aria-label') || input.placeholder || input.name, selector: input.id ? `#${CSS.escape(input.id)}` : input.name ? `[name="${CSS.escape(input.name)}"]` : element.tagName.toLowerCase() };
        }),
        submitSelector: form.querySelector('button[type="submit"], input[type="submit"]')?.id ? `#${CSS.escape((form.querySelector('button[type="submit"], input[type="submit"]') as HTMLElement).id)}` : undefined,
        purpose: form.getAttribute('aria-label') || form.id || 'User Input Form',
      })),
      headings: Array.from(document.querySelectorAll('h1,h2,h3')).map((node) => (node as HTMLElement).innerText.trim()).filter(Boolean).slice(0, 15),
      rawTextSnippet: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 3000),
    }));
    return { ...data, screenshotBase64: toBase64(await page.screenshot({ type: 'jpeg', quality: 65 })) };
  } finally {
    await browser.close();
  }
}
