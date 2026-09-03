import puppeteer, { type Browser, type ElementHandle, type Page } from '@cloudflare/puppeteer';
import type { ActionStep, WebMCPToolDefinition } from '../shared/types';
import type { Env } from './env';

const ACTION_TIMEOUT = 8000;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function visibleTarget(page: Page, selector: string, editable = false): Promise<ElementHandle<Element>> {
  const deadline = Date.now() + ACTION_TIMEOUT;
  while (Date.now() < deadline) {
    const candidates = await page.$$(selector);
    for (const candidate of candidates) {
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
      await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      return null;
    case 'fill':
    case 'type': {
      if (!selector) throw new Error('Fill step is missing a selector.');
      const target = await visibleTarget(page, selector, true);
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
        const target = await visibleTarget(page, selector);
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
          const target = await visibleTarget(page, selector);
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
      const target = await visibleTarget(page, selector);
      await target.select(value);
      await target.dispose();
      return null;
    }
    case 'check':
    case 'uncheck': {
      if (!selector) throw new Error(`${step.type} step is missing a selector.`);
      const target = await visibleTarget(page, selector);
      await target.evaluate((element, type) => {
        const input = element as HTMLInputElement;
        if (input.checked !== (type === 'check')) input.click();
      }, step.type);
      await target.dispose();
      return null;
    }
    case 'hover': {
      if (!selector) throw new Error('Hover step is missing a selector.');
      const target = await visibleTarget(page, selector);
      await target.hover();
      await target.dispose();
      return null;
    }
    case 'wait_for':
      if (selector) await visibleTarget(page, selector);
      else await new Promise((resolve) => setTimeout(resolve, step.timeoutMs || 1000));
      return null;
    case 'scroll':
      await page.evaluate(() => window.scrollBy({ top: 500, behavior: 'smooth' }));
      return null;
    case 'extract_text': {
      const text = await page.$eval(selector || 'body', (element) => (element as HTMLElement).innerText || element.textContent || '');
      return { text: text.trim().slice(0, 5000), characterCount: text.length };
    }
    case 'extract_links': {
      const links = await page.$$eval(selector || 'a', (elements) => elements.map((element) => ({
        text: (element as HTMLElement).innerText.trim(),
        href: (element as HTMLAnchorElement).href,
      })).filter((link) => link.text && link.href).slice(0, 30));
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

export async function executeRecipe(env: Env, tool: WebMCPToolDefinition, parameters: Record<string, unknown>, onStep?: (message: string) => Promise<void>): Promise<{ result: unknown; screenshotBase64?: string }> {
  const browser: Browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
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
  const browser: Browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
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
