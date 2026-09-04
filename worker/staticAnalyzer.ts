/**
 * Static (no-browser) page analyzer — the Browser Rendering quota saver.
 *
 * Fetches the raw HTML with a normal fetch() and parses it with HTMLRewriter
 * (runs on Workers CPU, zero Browser Rendering quota). Produces the same
 * shape as worker/browser.ts's analyzePage so the LLM tool generator and the
 * rest of the pipeline don't care which path produced the data.
 *
 * Used when:
 *  - The page renders its content server-side (most docs, news, wiki, blogs,
 *    stores, forms — anything without a JS app shell), or
 *  - A caller only needs the screenshot, not the full analysis.
 *
 * Callers MUST check `usable` and fall back to Browser Rendering when false
 * (JS-heavy shells, bot challenges, truncated/tiny responses).
 */
import type { PageAnalysisResult } from '../shared/types';

export interface StaticAnalysis {
  url: string;
  title: string;
  interactiveElements: PageAnalysisResult['interactiveElements'];
  forms: PageAnalysisResult['forms'];
  headings: string[];
  navigationLinks: PageAnalysisResult['navigationLinks'];
  rawTextSnippet: string;
  /** false when the fetch/parse suggests a browser render is required */
  usable: boolean;
  /** why the static analysis was insufficient (for logs + fallback decisions) */
  reason?: string;
  statusCode: number;
}

const MAX_HTML_BYTES = 3_000_000; // ~3 MB cap — larger pages fall back to the browser
const MAX_TEXT_CHARS = 3000;

function makeSelector(tag: string, id: string | null, name: string | null): string {
  if (id) return `#${cssEscape(id)}`;
  if (name) return `${tag}[name="${cssEscape(name)}"]`;
  return tag;
}

function cssEscape(value: string): string {
  return value.replace(/([^a-zA-Z0-9_-]+)/g, '\\$1');
}

interface FieldDraft {
  name: string;
  type: string;
  label: string | null;
  selector: string;
  required: boolean;
}

interface FormDraft {
  id: string;
  action: string;
  method: string;
  fields: FieldDraft[];
  submitSelector?: string;
  purpose: string;
}

export async function analyzeStatic(url: string): Promise<StaticAnalysis> {
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      headers: {
        // A mainstream UA — some sites 403 the default Workers fetch UA.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
  } catch (error) {
    return emptyResult(url, 0, `fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) {
    return emptyResult(response.url || url, response.status, `HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!/text\/html|application\/xhtml/i.test(contentType)) {
    return emptyResult(response.url || url, response.status, `non-HTML content-type: ${contentType}`);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_HTML_BYTES) {
    return emptyResult(response.url || url, response.status, `page too large (${buffer.byteLength} bytes)`);
  }

  const finalUrl = response.url || url;
  const state = {
    title: '',
    headings: [] as string[],
    links: [] as PageAnalysisResult['navigationLinks'],
    elements: [] as PageAnalysisResult['interactiveElements'],
    textParts: [] as string[],
    textLength: 0,
    challenge: false,
  };
  const forms: FormDraft[] = [];
  let formStack: FormDraft[] = [];
  let elemIndex = 0;
  let truncated = false;

  const rewriter = new HTMLRewriter()
    .on('title', {
      text(text) { state.title += text.text; },
    })
    .on('h1, h2, h3', {
      text(text) {
        if (text.text) state.headings.push(text.text.trim());
      },
    })
    .on('a[href]', {
      element(el) {
        const href = el.getAttribute('href') || '';
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
        if (state.links.length < 15) {
          state.links.push({ text: '', href: new URL(href, finalUrl).toString() });
        }
      },
      text(text) {
        const last = state.links[state.links.length - 1];
        if (last && !last.text) last.text = text.text.trim().slice(0, 80);
      },
    })
    .on('form', {
      element(el) {
        const form: FormDraft = {
          id: el.getAttribute('id') || `form_${forms.length}`,
          action: el.getAttribute('action') || '',
          method: (el.getAttribute('method') || 'GET').toUpperCase(),
          fields: [],
          purpose: el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('id') || 'User Input Form',
        };
        forms.push(form);
        formStack.push(form);
      },
    })
    .on('input, select, textarea', {
      element(el) {
        const tag = el.tagName.toLowerCase();
        const name = el.getAttribute('name');
        const type = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : tag;
        if (type === 'hidden') return;
        const field: FieldDraft = {
          name: name || el.getAttribute('id') || `field_${elemIndex}`,
          type,
          label: el.getAttribute('aria-label') || el.getAttribute('placeholder') || name,
          selector: makeSelector(tag, el.getAttribute('id'), name),
          required: el.hasAttribute('required'),
        };
        const currentForm = formStack[formStack.length - 1];
        if (currentForm) currentForm.fields.push(field);
        if (state.elements.length < 100) {
          state.elements.push({
            id: `elem_${elemIndex++}`,
            tagName: tag,
            type,
            name: name || undefined,
            placeholder: el.getAttribute('placeholder') || undefined,
            ariaLabel: el.getAttribute('aria-label') || undefined,
            selector: field.selector,
            isVisible: true,
            isEnabled: !el.hasAttribute('disabled'),
            isInteractive: true,
          } as PageAnalysisResult['interactiveElements'][number]);
        }
      },
    })
    .on('button, [role="button"]', {
      element(el) {
        const tag = el.tagName.toLowerCase();
        const name = el.getAttribute('name');
        const currentForm = formStack[formStack.length - 1];
        const submitType = (el.getAttribute('type') || '').toLowerCase() === 'submit';
        if (currentForm && submitType && el.getAttribute('id')) {
          currentForm.submitSelector = `#${cssEscape(el.getAttribute('id')!)}`;
        }
        if (state.elements.length < 100) {
          state.elements.push({
            id: `elem_${elemIndex++}`,
            tagName: tag,
            name: name || undefined,
            ariaLabel: el.getAttribute('aria-label') || undefined,
            selector: makeSelector(tag, el.getAttribute('id'), name),
            isVisible: true,
            isEnabled: !el.hasAttribute('disabled'),
            isInteractive: true,
          } as PageAnalysisResult['interactiveElements'][number]);
        }
      },
      text(text) {
        if (!text.text.trim()) return;
        const currentForm = formStack[formStack.length - 1];
        if (currentForm && !currentForm.submitSelector) {
          // Remember nothing here — submit detection stays attribute-based.
        }
        if (state.textLength < MAX_TEXT_CHARS) {
          state.textParts.push(text.text);
          state.textLength += text.text.length;
        }
      },
    })
    .on('p, li, td, th, h4', {
      text(text) {
        if (state.textLength < MAX_TEXT_CHARS) {
          state.textParts.push(text.text);
          state.textLength += text.text.length;
        }
      },
    })
    .on('noscript, script, style', {
      text(text) {
        // HTMLRewriter still streams text inside these; drop it so raw text
        // snippets aren't polluted with JS/CSS.
        void text;
        truncated = truncated; // no-op keep TS happy
      },
    });

  try {
    await rewriter.transform(new Response(buffer)).arrayBuffer();
  } catch (error) {
    return emptyResult(finalUrl, response.status, `parse failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // --- usability heuristics: decide whether the browser fallback is needed ---
  const title = state.title.trim();
  const challenge = /just a moment|attention required|checking your browser|enable javascript|cf-browser-verification/i.test(title)
    || state.challenge
    || response.headers.get('server') === 'cloudflare' && /challenge/i.test(title);

  let reason: string | undefined;
  if (challenge) reason = 'bot challenge page';
  else if (!title && state.elements.length === 0) reason = 'empty document (likely JS-rendered shell)';
  else if (state.elements.length < 3 && forms.length === 0) reason = 'too few interactive elements (likely JS-rendered)';

  return {
    url: finalUrl,
    title: title || new URL(finalUrl).hostname,
    interactiveElements: state.elements,
    forms: forms.filter((f) => f.fields.length > 0) as PageAnalysisResult['forms'],
    headings: state.headings.map((h) => h.trim()).filter(Boolean).slice(0, 15),
    navigationLinks: state.links,
    rawTextSnippet: state.textParts.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS),
    usable: !reason,
    reason,
    statusCode: response.status,
  };
}

function emptyResult(url: string, statusCode: number, reason: string): StaticAnalysis {
  return {
    url,
    title: '',
    interactiveElements: [],
    forms: [],
    headings: [],
    navigationLinks: [],
    rawTextSnippet: '',
    usable: false,
    reason,
    statusCode,
  };
}
