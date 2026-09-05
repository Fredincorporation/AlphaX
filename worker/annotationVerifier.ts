import type { ActionStep, WebMCPToolDefinition } from '../shared/types';

/**
 * Phase 4: annotation trust gap closer.
 *
 * Gating decisions must never rely on LLM-proposed readOnly/destructive flags.
 * This classifier walks the actual actionRecipe and derives verified
 * annotations from what the recipe *does*, independent of what the LLM claimed.
 */

const SUBMIT_SELECTOR_PATTERNS = [
  /button\[type\s*=\s*["']?submit/i,
  /input\[type\s*=\s*["']?submit/i,
  /:submit/i,
  /\bform\b.*\bbutton\b/i,
  /type\s*=\s*["']?submit/i,
];

const SUBMIT_TEXT_HINTS = ['sign in', 'log in', 'logIn', 'signin', 'submit', 'checkout', 'pay', 'purchase', 'place order', 'confirm payment', 'delete', 'remove', 'subscribe'];

const SEARCH_SELECTOR_PATTERNS = [
  /input\[type\s*=\s*["']?search/i,
  /\[name\s*=\s*["']?q["']?\]/i,
  /\[name\s*=\s*["']?query["']?\]/i,
  /\[name\s*=\s*["']?search["']?\]/i,
  /\[role\s*=\s*["']?searchbox/i,
  /\[aria-label\s*=\s*["']?search/i,
  /#search/i,
  /\.search-input/i,
];

const WRITE_ACTION_TYPES: ActionStep['type'][] = ['fill', 'type', 'select', 'check', 'uncheck', 'press', 'evaluate_js', 'submit_form'];

export interface VerifiedAnnotations {
  readOnly: boolean;
  destructive: boolean;
  requiresConfirmation: boolean;
  reasons: string[];
}

function isSubmitSelector(selector: string): boolean {
  return SUBMIT_SELECTOR_PATTERNS.some((pattern) => pattern.test(selector))
    || SUBMIT_TEXT_HINTS.some((hint) => selector.toLowerCase().includes(hint));
}

function isSearchContext(selector: string | undefined): boolean {
  if (!selector) return false;
  return SEARCH_SELECTOR_PATTERNS.some((pattern) => pattern.test(selector));
}

export function verifyAnnotations(tool: WebMCPToolDefinition): VerifiedAnnotations {
  const reasons: string[] = [];
  let destructive = false;
  let write = false;
  let navigates = false;

  for (const step of tool.actionRecipe || []) {
    switch (step.type) {
      case 'click':
      case 'submit_form':
        if (step.type === 'submit_form' || isSubmitSelector(step.selector || '')) {
          destructive = true;
          reasons.push(`step ${step.id} submits a form (${step.selector || step.type})`);
        }
        break;
      case 'fill':
      case 'type':
      case 'select':
      case 'check':
      case 'uncheck':
        if (!isSearchContext(step.selector)) {
          write = true;
          reasons.push(`step ${step.id} writes via ${step.type} outside a search context (${step.selector || 'no selector'})`);
        }
        break;
      case 'press':
        if ((step.key || '').toLowerCase() === 'enter' && !isSearchContext(step.selector)) {
          // Pressing Enter in a non-search field can submit forms.
          destructive = true;
          reasons.push(`step ${step.id} presses Enter outside a search context`);
        }
        break;
      case 'navigate':
        navigates = true;
        break;
      case 'evaluate_js':
        destructive = true;
        reasons.push(`step ${step.id} evaluates arbitrary JavaScript`);
        break;
      default:
        // extract_*, screenshot, hover, scroll, wait_for — read-only.
        break;
    }
  }

  // Navigation away from the source URL is a side effect worth flagging when
  // the tool claims to be read-only (e.g. deep links to flows).
  const sourceOrigin = tool.annotations?.sourceUrl ? safeOrigin(tool.annotations.sourceUrl) : undefined;
  const crossOriginNav = (tool.actionRecipe || []).some((step) => {
    if (step.type !== 'navigate' || !step.url) return false;
    const stepOrigin = safeOrigin(step.url);
    return sourceOrigin ? stepOrigin !== sourceOrigin : Boolean(stepOrigin);
  });
  if (crossOriginNav) {
    write = true;
    reasons.push('recipe navigates to a different origin than its declared source URL');
  }

  const readOnly = !write && !destructive;
  const requiresConfirmation = !readOnly || destructive;

  return {
    readOnly,
    destructive,
    requiresConfirmation,
    reasons,
  };
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
