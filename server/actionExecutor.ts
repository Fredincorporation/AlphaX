import { Page } from 'playwright';
import {
  WebMCPToolDefinition,
  ToolExecutionRequest,
  ToolExecutionResponse,
  ExecutionLogEntry,
  ActionStep,
  ConfirmationRequest
} from '../shared/types.js';
import { browserManager } from './browserManager.js';
import { validateNavigationTarget } from './navigationPolicy.js';
import { requiresConfirmation } from './supervisionPolicy.js';

type LogCallback = (log: ExecutionLogEntry) => void;
type ConfirmationCallback = (req: ConfirmationRequest) => Promise<boolean>;

async function performNavigationAction(page: Page, action: () => Promise<void>, timeoutMs: number) {
  const navigation = page.waitForNavigation({
    waitUntil: 'domcontentloaded',
    timeout: timeoutMs,
  }).catch(() => null);
  const actionResult = await Promise.allSettled([action(), navigation]);
  if (actionResult[0].status === 'rejected') throw actionResult[0].reason;
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs });
  } catch { }
  try {
    await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 4000) });
  } catch { }
  await page.waitForTimeout(300);
}

async function evaluateWithNavigationRetry<T>(page: Page, evaluate: () => Promise<T>, timeoutMs = 8000): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await evaluate();
    } catch (error: any) {
      const isNavigationRace = /Execution context was destroyed|most likely because of a navigation/i.test(error?.message || '');
      if (!isNavigationRace || attempt === 2) throw error;
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs });
      } catch { }
      await page.waitForTimeout(500);
    }
  }
  throw new Error('Page evaluation failed after navigation retries.');
}

function getActionSelector(selector: string, tool: WebMCPToolDefinition): string {
  const isAmazonSearch = /amazon\./i.test(`${tool.domain} ${tool.annotations.sourceUrl || ''}`)
    && /search/i.test(`${tool.name} ${tool.description}`);
  if (isAmazonSearch && /twotabsearchtextbox/i.test(selector)) {
    return '#twotabsearchtextbox:visible, input[name="field-keywords"]:visible, input[type="search"]:visible, input[placeholder*="Search"]:visible, input[aria-label*="Search"]:visible';
  }
  return selector;
}

function getActionTimeout(step: ActionStep, tool: WebMCPToolDefinition): number {
  const isAmazonSearch = /amazon\./i.test(`${tool.domain} ${tool.annotations.sourceUrl || ''}`)
    && /search/i.test(`${tool.name} ${tool.description}`);
  return isAmazonSearch ? Math.max(step.timeoutMs || 0, 20000) : (step.timeoutMs || 8000);
}

export class ActionExecutor {
  private pendingConfirmations: Map<string, { resolve: (val: boolean) => void; reject: (err: any) => void }> = new Map();

  async executeTool(
    sessionId: string,
    tool: WebMCPToolDefinition,
    request: ToolExecutionRequest,
    options: {
      onLog?: LogCallback;
      onConfirmationRequired?: ConfirmationCallback;
      supervisionMode?: 'strict' | 'supervised' | 'autonomous';
    } = {}
  ): Promise<ToolExecutionResponse> {
    const startTime = Date.now();
    const logs: ExecutionLogEntry[] = [];
    const executionId = request.id || `exec_${Date.now()}`;

    const addLog = (level: ExecutionLogEntry['level'], message: string, stepIndex?: number, data?: any) => {
      const entry: ExecutionLogEntry = {
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        level,
        message,
        stepIndex,
        data,
      };
      logs.push(entry);
      options.onLog?.(entry);
    };

    addLog('info', `Starting execution of tool: [${tool.name}] (${tool.id})`);

    // 1. Confirmation Gate Check
    const needsConfirmation = requiresConfirmation(tool, options.supervisionMode || 'supervised');

    let confirmedByHuman = false;

    if (needsConfirmation) {
      addLog('security', `Gatekeeper triggered: Action requires human confirmation.`);

      const confirmReq: ConfirmationRequest = {
        id: `conf_${Date.now()}`,
        toolExecutionId: executionId,
        toolName: tool.name,
        parameters: request.parameters,
        riskLevel: tool.annotations.destructive ? 'high' : 'medium',
        impactDescription: `Agent requested to execute "${tool.name}" on ${tool.domain} with parameters: ${JSON.stringify(request.parameters)}`,
        status: 'pending',
        timestamp: new Date().toISOString(),
        timeoutSeconds: 60,
      };

      if (!options.onConfirmationRequired) {
        const error = 'Execution blocked: confirmation is required but no supervision channel is available.';
        addLog('error', error);
        return {
          id: `res_${Date.now()}`,
          requestId: request.id,
          toolName: tool.name,
          status: 'error',
          error,
          executionTimeMs: Date.now() - startTime,
          logs,
          provenance: {
            targetUrl: tool.annotations.sourceUrl || '',
            executedStepsCount: 0,
            confirmedByHuman: false,
            timestamp: new Date().toISOString(),
            toolVersion: '1.0.0',
          },
        };
      }

      {
        const approved = await options.onConfirmationRequired(confirmReq);
        if (!approved) {
          addLog('warn', `Tool execution rejected by human supervisor.`);
          return {
            id: `res_${Date.now()}`,
            requestId: request.id,
            toolName: tool.name,
            status: 'rejected',
            error: 'Execution cancelled: Human supervisor rejected the tool invocation.',
            executionTimeMs: Date.now() - startTime,
            logs,
            provenance: {
              targetUrl: tool.annotations.sourceUrl || '',
              executedStepsCount: 0,
              confirmedByHuman: false,
              timestamp: new Date().toISOString(),
              toolVersion: '1.0.0',
            },
          };
        }
        confirmedByHuman = true;
        addLog('success', `Human supervisor approved execution.`);
      }
    }

    // 2. Execute Action Recipe Steps
    const page = await browserManager.getPage(sessionId);
    const params = request.parameters || {};
    let lastResult: any = null;
    let executedStepsCount = 0;

    try {
      for (let i = 0; i < tool.actionRecipe.length; i++) {
        const step = tool.actionRecipe[i];
        const stepNum = i + 1;
        addLog('info', `Step ${stepNum}/${tool.actionRecipe.length}: [${step.type}] ${step.description || ''}`, i);

        // Resolve dynamic parameter
        let stepValue = step.value || step.text || '';
        if (step.dynamicParam && params[step.dynamicParam] !== undefined) {
          stepValue = String(params[step.dynamicParam]);
        }

        switch (step.type) {
          case 'navigate': {
            let navUrl = '';

            // 1. Resolve URL from step template and dynamic params
            if (step.url) {
              if (step.dynamicParam && stepValue) {
                // If the URL template has a placeholder like {query} or {topic}
                if (step.url.includes(`{${step.dynamicParam}}`)) {
                  navUrl = step.url.replace(`{${step.dynamicParam}}`, encodeURIComponent(stepValue));
                } else if (step.url.endsWith('=') || step.url.endsWith('/') || step.url.includes('?')) {
                  navUrl = `${step.url}${encodeURIComponent(stepValue)}`;
                } else {
                  navUrl = step.url;
                }
              } else {
                navUrl = step.url;
              }
            }

            if (!navUrl) {
              throw new Error('Navigation rejected: recipe did not provide a URL target.');
            }
            navUrl = validateNavigationTarget(navUrl, page.url(), tool.domain);

            try {
              addLog('info', `Navigating to: ${navUrl}`, i);
              await page.goto(navUrl, { waitUntil: 'domcontentloaded', timeout: step.timeoutMs || 25000 });
            } catch (navErr: any) {
              if (navErr.message?.includes('ERR_NAME_NOT_RESOLVED')) {
                throw new Error(`Navigation failed: Host for "${navUrl}" could not be resolved. Please verify target address.`);
              }
              if (navErr.message?.includes('Timeout') || navErr.name === 'TimeoutError') {
                throw new Error(`Navigation timed out loading "${navUrl}".`);
              }
              throw navErr;
            }
            break;
          }

          case 'click': {
            if (!step.selector) throw new Error('Missing selector for click step');
            await page.waitForSelector(step.selector, { timeout: step.timeoutMs || 8000 });
            if (step.waitForNavigation) {
              await performNavigationAction(
                page,
                () => page.click(step.selector!),
                step.timeoutMs || 8000
              );
            } else {
              await page.click(step.selector);
            }
            break;
          }

          case 'fill':
          case 'type': {
            if (!step.selector) throw new Error('Missing selector for fill step');
            const selector = getActionSelector(step.selector, tool);
            await page.waitForSelector(selector, { timeout: getActionTimeout(step, tool) });
            await page.locator(selector).first().fill(stepValue);
            break;
          }

          case 'select': {
            if (!step.selector) throw new Error('Missing selector for select step');
            await page.waitForSelector(step.selector, { timeout: step.timeoutMs || 8000 });
            await page.selectOption(step.selector, stepValue);
            break;
          }

          case 'check': {
            if (!step.selector) throw new Error('Missing selector for check step');
            await page.waitForSelector(step.selector, { timeout: step.timeoutMs || 8000 });
            await page.check(step.selector);
            break;
          }

          case 'uncheck': {
            if (!step.selector) throw new Error('Missing selector for uncheck step');
            await page.waitForSelector(step.selector, { timeout: step.timeoutMs || 8000 });
            await page.uncheck(step.selector);
            break;
          }

          case 'press': {
            const keyToPress = step.key || stepValue || 'Enter';
            if (step.waitForNavigation) {
              await performNavigationAction(
                page,
                () => step.selector
                  ? page.press(step.selector, keyToPress)
                  : page.keyboard.press(keyToPress),
                step.timeoutMs || 8000
              );
            } else if (step.selector) {
              await page.press(step.selector, keyToPress);
            } else {
              await page.keyboard.press(keyToPress);
            }
            break;
          }

          case 'hover': {
            if (!step.selector) throw new Error('Missing selector for hover step');
            await page.hover(step.selector);
            break;
          }

          case 'scroll': {
            await evaluateWithNavigationRetry(page, () => page.evaluate(() => window.scrollBy({ top: 500, behavior: 'smooth' })));
            break;
          }

          case 'wait_for': {
            if (step.selector) {
              await page.waitForSelector(step.selector, { timeout: step.timeoutMs || 8000 });
            } else {
              await page.waitForTimeout(step.timeoutMs || 1000);
            }
            break;
          }

          case 'extract_text': {
            const sel = step.selector || 'body';
            try {
              await page.waitForLoadState('domcontentloaded', { timeout: step.timeoutMs || 8000 });
            } catch { }
            if (/amazon|shop|store|commerce/i.test(`${tool.domain} ${tool.name}`) && /search/i.test(tool.name)) {
              const readProducts = () => evaluateWithNavigationRetry(page, () => page.evaluate(() => Array.from(document.querySelectorAll('[data-component-type="s-search-result"], .s-result-item'))
                .map(card => {
                  const title = card.querySelector('h2 a span, h2 span, h2')?.textContent?.trim() || '';
                  const url = (card.querySelector('h2 a') as HTMLAnchorElement | null)?.href || '';
                  const price = card.querySelector('.a-price .a-offscreen, .a-price-whole')?.textContent?.trim() || '';
                  const rating = card.querySelector('.a-icon-alt')?.textContent?.trim() || '';
                  const availability = card.querySelector('.a-size-base.a-color-price, .a-color-state')?.textContent?.trim() || '';
                  return { title, url, price, rating, availability };
                })
                .filter(item => item.title && item.url)
                .slice(0, 20)));
              const products = await readProducts();
              if (products.length > 0) {
                lastResult = products;
                addLog('success', `Extracted ${products.length} structured products`, i);
                break;
              }
            }
            const readText = () => evaluateWithNavigationRetry(page, () => page.evaluate((selector) => {
              const el = document.querySelector(selector);
              return el ? (el as HTMLElement).innerText.trim() : '';
            }, sel));
            const textContent = await readText();
            lastResult = { text: textContent.slice(0, 5000), characterCount: textContent.length };
            addLog('success', `Extracted ${textContent.length} characters of text`, i);
            break;
          }

          case 'extract_links': {
            const sel = step.selector || 'a';
            const links = await evaluateWithNavigationRetry(page, () => page.evaluate((selector) => {
              return Array.from(document.querySelectorAll(selector))
                .map(a => ({
                  text: (a as HTMLElement).innerText.trim(),
                  href: (a as HTMLAnchorElement).href,
                }))
                .filter(l => l.text.length > 0 && l.href && !l.href.startsWith('javascript:'))
                .slice(0, 30);
              }, sel));
            lastResult = { links, count: links.length };
            addLog('success', `Extracted ${links.length} links`, i);
            break;
          }

          case 'screenshot': {
            const screenshot = await browserManager.captureScreenshot(sessionId);
            lastResult = { screenshotBase64: screenshot };
            addLog('success', `Captured live screenshot`, i);
            break;
          }

          case 'evaluate_js': {
            const evalResult = await evaluateWithNavigationRetry(page, () => page.evaluate((code) => {
              try {
                return eval(code);
              } catch (e: any) {
                return { error: e.message };
              }
            }, stepValue));
            lastResult = evalResult;
            break;
          }

          default:
            addLog('warn', `Unknown action type: ${step.type}`, i);
        }

        executedStepsCount++;
      }

      // Final screenshot capture for visual provenance
      const finalScreenshotBase64 = await browserManager.captureScreenshot(sessionId).catch(() => undefined);

      addLog('success', `Tool execution completed successfully! Total steps: ${executedStepsCount}`);

      return {
        id: `res_${Date.now()}`,
        requestId: request.id,
        toolName: tool.name,
        status: 'success',
        result: lastResult || { message: `Tool ${tool.name} completed successfully`, stepsExecuted: executedStepsCount },
        executionTimeMs: Date.now() - startTime,
        logs,
        finalScreenshotBase64,
        provenance: {
          targetUrl: page.url(),
          executedStepsCount,
          confirmedByHuman,
          timestamp: new Date().toISOString(),
          toolVersion: '1.0.0',
        },
      };
    } catch (error: any) {
      addLog('error', `Execution failed: ${error.message}`);
      const errScreenshot = await browserManager.captureScreenshot(sessionId).catch(() => undefined);

      return {
        id: `res_${Date.now()}`,
        requestId: request.id,
        toolName: tool.name,
        status: 'error',
        error: error.message,
        executionTimeMs: Date.now() - startTime,
        logs,
        finalScreenshotBase64: errScreenshot,
        provenance: {
          targetUrl: page.url(),
          executedStepsCount,
          confirmedByHuman,
          timestamp: new Date().toISOString(),
          toolVersion: '1.0.0',
        },
      };
    }
  }
}

export const actionExecutor = new ActionExecutor();
