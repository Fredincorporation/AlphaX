import type { Browser, BrowserContext, Page } from 'playwright';
import { validateNavigationTarget } from './navigationPolicy.js';
import { PageAnalysisResult, PageElementInfo, FormInfo } from '../shared/types.js';

process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
const { chromium } = await import('playwright');

const MAX_SESSIONS = 4;
const SESSION_IDLE_MS = 10 * 60 * 1000;

interface ManagedSession {
  sessionId: string;
  context: BrowserContext;
  page: Page;
  currentUrl: string;
  lastActive: number;
  highlightOverlayActive?: boolean;
}

async function evaluatePageWithRetry<T>(page: Page, evaluate: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await evaluate();
    } catch (error: any) {
      const message = error?.message || '';
      const isTransientNavigation = /Execution context was destroyed|most likely because of a navigation/i.test(message);
      if (!isTransientNavigation || attempt === 2) throw error;
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
      await page.waitForTimeout(250);
    }
  }
  throw new Error('Page analysis evaluation failed after navigation retries.');
}

function isAutomationChallenge(url: string, title: string): boolean {
  return /\/challenge(?:[/?#]|$)|splashui\/challenge|captcha|verify you are human|robot check|access denied/i.test(`${url} ${title}`);
}

export class BrowserManager {
  private browser: Browser | null = null;
  private sessions: Map<string, ManagedSession> = new Map();
  private screencastListeners: Map<string, Set<(frameBase64: string) => void>> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanupStaleSessions(), 60000);
    this.cleanupInterval.unref();
  }

  async initBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
        ],
      });
      const browser = this.browser;
      browser.on('disconnected', () => {
        if (this.browser === browser) this.browser = null;
      });
    }
    return this.browser;
  }

  async getOrCreateSession(sessionId: string): Promise<ManagedSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastActive = Date.now();
      return existing;
    }

    const browser = await this.initBrowser();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 AlphaX-WebMCP-Mediator/1.0',
    });

    const page = await context.newPage();
    await page.route('**/*', async (route) => {
      const resourceType = route.request().resourceType();
      if (resourceType === 'media' || resourceType === 'font' || resourceType === 'eventsource') {
        await route.abort();
      } else {
        await route.continue();
      }
    });
    page.setDefaultTimeout(20000);

    const session: ManagedSession = {
      sessionId,
      context,
      page,
      currentUrl: 'about:blank',
      lastActive: Date.now(),
    };

    await this.evictSessionsIfNeeded();

    this.sessions.set(sessionId, session);
    return session;
  }

  private async evictSessionsIfNeeded(): Promise<void> {
    if (this.sessions.size < MAX_SESSIONS) return;

    const oldest = [...this.sessions.values()]
      .sort((left, right) => left.lastActive - right.lastActive)[0];
    if (oldest) await this.closeSession(oldest.sessionId);
  }

  async navigateTo(sessionId: string, url: string, allowRecovery = true): Promise<{ title: string; currentUrl: string }> {
    const session = await this.getOrCreateSession(sessionId);
    const parsedUrl = validateNavigationTarget(url, session.page.url());

    try {
      await session.page.goto(parsedUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
    } catch (error: any) {
      const message = error?.message || '';
      const targetCrashed = /page crashed|target crashed|target page, context or browser has been closed/i.test(message);
      if (allowRecovery && targetCrashed) {
        await this.closeSession(sessionId);
        return this.navigateTo(sessionId, parsedUrl, false);
      }
      if (targetCrashed) {
        throw new Error(`Target site crashed Chromium while loading ${parsedUrl}. The page may be blocking automation and cannot be completed in the controlled Chromium window or through a popup.`);
      }
      throw error;
    }

    // Wait a brief moment for dynamic JS to render
    try {
      await session.page.waitForLoadState('networkidle', { timeout: 4000 });
    } catch {
      // Network idle timeout is ok to ignore
    }

    session.currentUrl = session.page.url();
    session.lastActive = Date.now();

    const title = await session.page.title();
    if (isAutomationChallenge(session.currentUrl, title)) {
      throw new Error(`Target site presented an anti-bot challenge at ${session.currentUrl}. Analysis cannot continue until the site allows browser automation.`);
    }
    return { title, currentUrl: session.currentUrl };
  }

  async captureScreenshot(sessionId: string, fullPage: boolean = false): Promise<string> {
    const session = await this.getOrCreateSession(sessionId);
    const buffer = await session.page.screenshot({
      type: 'jpeg',
      quality: 80,
      fullPage,
    });
    return buffer.toString('base64');
  }

  async getPage(sessionId: string): Promise<Page> {
    const session = await this.getOrCreateSession(sessionId);
    return session.page;
  }

  async analyzePage(sessionId: string, allowRecovery = true): Promise<PageAnalysisResult> {
    const session = await this.getOrCreateSession(sessionId);
    const page = session.page;
    const url = page.url();
    const title = await page.title();
    let domain = 'unknown';
    try {
      domain = new URL(url).hostname;
    } catch { }

    // Extract interactive elements, forms, links, headings
    let analysisData;
    try {
      analysisData = await evaluatePageWithRetry(page, () => page.evaluate(() => {
      // 1. Interactive Elements
      const interactiveElements: any[] = [];
      const selectorCounter: Record<string, number> = {};

      const query = 'button, a, input, select, textarea, [role="button"], [role="link"], [role="searchbox"], [role="tab"], [tabindex]:not([tabindex="-1"])';
      const nodes = Array.from(document.querySelectorAll(query));

      nodes.slice(0, 100).forEach((el, index) => {
        const htmlEl = el as HTMLElement;
        const rect = htmlEl.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(htmlEl).visibility !== 'hidden' && window.getComputedStyle(htmlEl).display !== 'none';

        if (!isVisible && index > 20) return;

        // Generate clean robust selector
        let sel = '';
        if (htmlEl.id) {
          sel = `#${CSS.escape(htmlEl.id)}`;
        } else if (htmlEl.getAttribute('data-testid')) {
          sel = `[data-testid="${htmlEl.getAttribute('data-testid')}"]`;
        } else if (htmlEl.getAttribute('name')) {
          sel = `${htmlEl.tagName.toLowerCase()}[name="${htmlEl.getAttribute('name')}"]`;
        } else if (htmlEl.getAttribute('aria-label')) {
          sel = `${htmlEl.tagName.toLowerCase()}[aria-label="${htmlEl.getAttribute('aria-label')}"]`;
        } else if (htmlEl.getAttribute('placeholder')) {
          sel = `${htmlEl.tagName.toLowerCase()}[placeholder="${htmlEl.getAttribute('placeholder')}"]`;
        } else {
          const tag = htmlEl.tagName.toLowerCase();
          const cls = htmlEl.className && typeof htmlEl.className === 'string' ? '.' + htmlEl.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
          sel = `${tag}${cls}`;
        }

        interactiveElements.push({
          id: `elem_${index}`,
          tagName: htmlEl.tagName.toLowerCase(),
          type: (htmlEl as HTMLInputElement).type || undefined,
          role: htmlEl.getAttribute('role') || undefined,
          name: htmlEl.getAttribute('name') || undefined,
          placeholder: (htmlEl as HTMLInputElement).placeholder || undefined,
          ariaLabel: htmlEl.getAttribute('aria-label') || undefined,
          text: (htmlEl.innerText || (htmlEl as HTMLInputElement).value || '').trim().slice(0, 120),
          value: (htmlEl as HTMLInputElement).value || undefined,
          href: (htmlEl as HTMLAnchorElement).href || undefined,
          selector: sel,
          boundingBox: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          isVisible,
          isEnabled: !(htmlEl as HTMLButtonElement).disabled,
          isInteractive: true,
        });
      });

      // 2. Forms
      const forms: any[] = [];
      document.querySelectorAll('form').forEach((form, fIdx) => {
        const fields: any[] = [];
        form.querySelectorAll('input, select, textarea').forEach((input) => {
          const inp = input as HTMLInputElement;
          if (inp.type === 'hidden') return;
          fields.push({
            name: inp.name || inp.id,
            type: inp.type || 'text',
            label: inp.getAttribute('aria-label') || inp.placeholder || inp.name,
            placeholder: inp.placeholder,
            selector: inp.id ? `#${inp.id}` : (inp.name ? `[name="${inp.name}"]` : 'input'),
            required: inp.required,
            defaultValue: inp.value,
          });
        });

        const submitBtn = form.querySelector('button[type="submit"], input[type="submit"], button:not([type="button"])');
        forms.push({
          id: form.id || `form_${fIdx}`,
          action: form.action,
          method: form.method || 'GET',
          fields,
          submitSelector: submitBtn ? (submitBtn.id ? `#${submitBtn.id}` : 'button[type="submit"]') : undefined,
          purpose: form.getAttribute('aria-label') || form.id || 'User Input Form',
        });
      });

      // 3. Headings & Navigation
      const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
        .map(h => (h as HTMLElement).innerText.trim())
        .filter(t => t.length > 0)
        .slice(0, 15);

      const navLinks = Array.from(document.querySelectorAll('nav a, header a, [role="navigation"] a'))
        .map(a => ({
          text: (a as HTMLElement).innerText.trim(),
          href: (a as HTMLAnchorElement).href,
        }))
        .filter(l => l.text.length > 0 && l.href && !l.href.startsWith('javascript:'))
        .slice(0, 20);

      // 4. Raw text snippet
      const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 3000);

      return {
        interactiveElements,
        forms,
        headings,
        navigationLinks: navLinks,
        rawTextSnippet: bodyText,
      };
      }));
    } catch (error: any) {
      const message = error?.message || '';
      const pageCrashed = /page crashed|target crashed|target page, context or browser has been closed/i.test(message);
      if (allowRecovery && pageCrashed && url && url !== 'about:blank') {
        await this.closeSession(sessionId);
        const recoveredSession = await this.getOrCreateSession(sessionId);
        await recoveredSession.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        return this.analyzePage(sessionId, false);
      }
      throw new Error(`Page evaluate crashed while analyzing ${url}: ${message}`);
    }

    const screenshotBase64 = await this.captureScreenshot(sessionId);

    // Simple accessibility summary string
    const a11ySummary = `Title: ${title}\nHeadings: ${analysisData.headings.join(' | ')}\nForms found: ${analysisData.forms.length}\nInteractive targets: ${analysisData.interactiveElements.length}`;

    return {
      url,
      title,
      domain,
      summary: `${title} (${domain}) - ${analysisData.headings.slice(0, 3).join(', ')}`,
      screenshotBase64,
      interactiveElements: analysisData.interactiveElements,
      forms: analysisData.forms,
      headings: analysisData.headings,
      navigationLinks: analysisData.navigationLinks,
      a11yTreeSnippet: a11ySummary,
      rawTextSnippet: analysisData.rawTextSnippet,
      analyzedAt: new Date().toISOString(),
    };
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        await session.context.close();
      } catch { }
      this.sessions.delete(sessionId);
    }
  }

  private cleanupStaleSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActive > SESSION_IDLE_MS) {
        this.closeSession(sessionId);
      }
    }
  }
}

export const browserManager = new BrowserManager();
