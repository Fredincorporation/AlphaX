
import { Page } from 'playwright';
import { WebMCPToolDefinition } from '../shared/types.js';
import { browserManager } from './browserManager.js';
import { resolveVisibleTarget, getActionSelector, getFillSelector } from './actionExecutor.js';

async function executeStep(page: Page, step: any, tool: WebMCPToolDefinition, value: string): Promise<unknown> {
  const selector = step.selector;
  switch (step.type) {
    case 'navigate':
      if (!step.url) throw new Error('Navigation step is missing a URL.');
      await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      return null;
    case 'fill':
    case 'type': {
      if (!selector) throw new Error('Fill step is missing a selector.');
      const target = page.locator(getFillSelector(getActionSelector(selector, tool))).first();
      await target.fill(value);
      return null;
    }
    case 'click': {
      if (!selector) throw new Error('Click step is missing a selector.');
      const target = page.locator(selector).first();
      await target.click();
      return null;
    }
    case 'press': {
      const key = step.key || value || 'Enter';
      if (selector) await page.locator(selector).first().press(key);
      else await page.keyboard.press(key);
      return null;
    }
    case 'select': {
      if (!selector) throw new Error('Select step is missing a selector.');
      await page.locator(selector).first().selectOption(value);
      return null;
    }
    case 'check': {
      if (!selector) throw new Error('Check step is missing a selector.');
      await page.locator(selector).first().check();
      return null;
    }
    case 'uncheck': {
      if (!selector) throw new Error('Uncheck step is missing a selector.');
      await page.locator(selector).first().uncheck();
      return null;
    }
    case 'hover': {
      if (!selector) throw new Error('Hover step is missing a selector.');
      await page.locator(selector).first().hover();
      return null;
    }
    case 'wait_for':
      if (selector) await page.waitForSelector(selector, { timeout: step.timeoutMs || 8000 });
      else await page.waitForTimeout(step.timeoutMs || 1000);
      return null;
    case 'scroll':
      await page.evaluate(() => window.scrollBy({ top: 500, behavior: 'smooth' }));
      return null;
    case 'extract_text': {
      const text = await page.$eval(selector || 'body', (el) => (el as HTMLElement).innerText || el.textContent || '');
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
      return page.evaluate((code) => eval(code), value);
    case 'screenshot':
      return { screenshotBase64: (await page.screenshot({ type: 'jpeg', quality: 65 })).toString('base64') };
    default:
      throw new Error(`Action type "${step.type}" is not supported.`);
  }
}

export async function executeRecipe(
  tool: WebMCPToolDefinition,
  parameters: Record<string, unknown>,
  sessionId: string,
  onStep?: (message: string) => Promise<void>
): Promise<{ result: unknown; screenshotBase64?: string }> {
  const page = await browserManager.getPage(sessionId);
  let result: unknown = null;
  let screenshotBase64: string | undefined;

  for (const step of tool.actionRecipe) {
    const value = step.dynamicParam && parameters[step.dynamicParam] !== undefined
      ? String(parameters[step.dynamicParam])
      : String(step.value || step.text || '');

    await onStep?.(`Running ${step.type}${step.selector ? ` on ${step.selector}` : ''}`);

    try {
      const stepResult = await executeStep(page, step, tool, value);
      if (stepResult && typeof stepResult === 'object' && 'screenshotBase64' in stepResult) {
        screenshotBase64 = (stepResult as { screenshotBase64: string }).screenshotBase64;
      } else if (stepResult !== null) {
        result = stepResult;
      }
    } catch (error: any) {
      if (step.optional) continue;
      throw error;
    }
  }

  if (!screenshotBase64) {
    screenshotBase64 = (await page.screenshot({ type: 'jpeg', quality: 65 })).toString('base64');
  }

  return { result, screenshotBase64 };
}
