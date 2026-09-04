import { PageAnalysisResult, WebMCPToolDefinition, ActionStep } from '../shared/types.js';

/**
 * Model IDs rotate frequently on both providers (free-tier lineups especially).
 * generateWith* tries these in order and uses the first the API accepts, so a
 * single retirement doesn't silently degrade the app to heuristic tools.
 */
const GROQ_MODELS = [
  'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-20b',
  'llama-3.1-8b-instant',
];
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];

const SYSTEM_PROMPT = `You are an elite WebMCP (Web Model Context Protocol) architect and web automation engineer for AlphaX.
Your mission is to analyze a target website's live DOM structure, interactive forms, navigation links, and content, then synthesize 6 to 12 high-level, human-supervised WebMCP tool definitions.

WEBMCP TOOL PRINCIPLES:
1. HIGH-LEVEL & SEMANTIC: Name tools semantically like 'search_articles', 'submit_newsletter', 'filter_by_category', 'extract_pricing_tiers', 'add_to_cart', 'fetch_article_content'. DO NOT name them 'click_button_1'.
2. JSON SCHEMA: Every tool must have a valid JSON Schema for inputSchema with accurate property types, descriptions, and required arrays.
3. ACTION RECIPES: Each tool must provide an executable sequence of ActionSteps (navigate, click, fill, type, select, check, extract_text, extract_table, extract_links, wait_for, evaluate_js).
4. SAFETY & HUMAN SUPERVISION ANNOTATIONS:
   - readOnly: true for queries, search, data extraction
   - destructive: true for purchases, deletions, payment, checkout, account mutations
   - requiresConfirmation: true for any mutation, write operation, form submission, or external action
   - category: 'navigation' | 'data_extraction' | 'search' | 'form_submission' | 'interaction' | 'checkout' | 'account'
5. PARAMETER MAPPING: ActionStep with dynamicParam maps directly to a parameter key in inputSchema.

OUTPUT FORMAT:
Return a JSON object with a "tools" array containing WebMCPToolDefinition objects.`;

/**
 * Raised when a specific model ID is unavailable (retired / no access).
 * The generator loop treats this as "try the next model" rather than a fatal failure.
 */
class ModelNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelNotFoundError';
  }
}

export function findSearchInput(elements: PageAnalysisResult['interactiveElements']) {
  return elements
    .filter((element) => {
      const type = (element.type || 'text').toLowerCase();
      return element.tagName === 'input'
        && element.isVisible
        && element.isEnabled
        && !['button', 'hidden', 'image', 'reset', 'submit'].includes(type);
    })
    .map((element) => {
      const attributes = `${element.type || ''} ${element.name || ''} ${element.placeholder || ''} ${element.ariaLabel || ''}`.toLowerCase();
      let score = 0;
      if (element.type?.toLowerCase() === 'search') score += 10;
      if (/search|query|keyword/.test(attributes)) score += 5;
      if (element.name?.toLowerCase() === 'q') score += 4;
      return { element, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)[0]?.element;
}

export class LLMToolGenerator {
  private groqApiKey: string | null = null;
  private geminiApiKey: string | null = null;

  constructor() {
    this.groqApiKey = process.env.GROQ_API_KEY || null;
    this.geminiApiKey = process.env.GEMINI_API_KEY || null;
  }

  setGroqApiKey(key: string) {
    this.groqApiKey = key;
  }

  setGeminiApiKey(key: string) {
    this.geminiApiKey = key;
  }

  setApiKey(key: string) {
    // If it looks like a Groq key (gsk_...) or generic, set Groq
    if (key.startsWith('gsk_') || !key.startsWith('AIza')) {
      this.groqApiKey = key;
    } else {
      this.geminiApiKey = key;
    }
  }

  async generateTools(analysis: PageAnalysisResult): Promise<WebMCPToolDefinition[]> {
    // 1. Try Primary: GroqCloud
    if (this.groqApiKey) {
      const errors: string[] = [];
      for (const model of GROQ_MODELS) {
        try {
          const tools = await this.generateWithGroq(analysis, this.groqApiKey, model);
          if (tools && tools.length > 0) return tools;
        } catch (err) {
          errors.push(`${model}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (errors.length) console.warn(`[AlphaX LLM] All Groq models failed: ${errors.join(' | ')}`);
    }

    // 2. Try Fallback: Google Gemini
    if (this.geminiApiKey) {
      const errors: string[] = [];
      for (const model of GEMINI_MODELS) {
        try {
          const tools = await this.generateWithGemini(analysis, this.geminiApiKey, model);
          if (tools && tools.length > 0) return tools;
        } catch (err) {
          errors.push(`${model}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (errors.length) console.warn(`[AlphaX LLM] All Gemini models failed: ${errors.join(' | ')}`);
    }

    // 3. Fallback: Always-on AST / Heuristic Synthesizer
    console.log('🛡️ [AlphaX Synthesizer] Generating high-precision AST/heuristic WebMCP tools...');
    return this.generateHeuristicTools(analysis);
  }

  private async generateWithGroq(analysis: PageAnalysisResult, apiKey: string, model: string): Promise<WebMCPToolDefinition[]> {
    const userPrompt = `Analyze this live web page and synthesize high-level WebMCP tools:
URL: ${analysis.url}
Title: ${analysis.title}
Domain: ${analysis.domain}
Headings: ${JSON.stringify(analysis.headings)}
Forms: ${JSON.stringify(analysis.forms.slice(0, 6))}
Interactive Elements: ${JSON.stringify(analysis.interactiveElements.slice(0, 35))}
Navigation Links: ${JSON.stringify(analysis.navigationLinks.slice(0, 15))}
Page Text Content Snippet: ${analysis.rawTextSnippet.slice(0, 1500)}

Respond strictly in JSON format with a "tools" key containing an array of tool objects conforming to WebMCP standard:
{
  "tools": [
    {
      "id": "${analysis.domain}_example_action",
      "name": "example_action",
      "description": "Clear high-level purpose of tool for autonomous agent",
      "inputSchema": {
        "type": "object",
        "properties": {
          "paramName": { "type": "string", "description": "Parameter purpose" }
        },
        "required": ["paramName"]
      },
      "annotations": {
        "readOnly": true,
        "destructive": false,
        "requiresConfirmation": false,
        "category": "search",
        "confidenceScore": 0.98
      },
      "actionRecipe": [
        {
          "id": "step_1",
          "type": "navigate",
          "url": "https://example.com",
          "description": "Navigate to page"
        }
      ]
    }
  ]
}`;

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 4096,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      // 404/400 model_not_found → try next model in the chain; 429/5xx → abort chain (retrying won't help mid-request).
      const permanent = res.status === 404 || /model_not_found|does not exist/i.test(errBody);
      const err = new Error(`Groq API error HTTP ${res.status} (${model}): ${errBody.slice(0, 300)}`);
      (err as any).permanent = permanent;
      if (!permanent) throw err;
      // For model-level failures, skip straight to heuristic-quality by signaling caller to continue the loop.
      throw new ModelNotFoundError(err.message);
    }

    const data = await res.json() as any;
    const content = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    const rawList: any[] = Array.isArray(parsed) ? parsed : parsed.tools || parsed.toolDefinitions || Object.values(parsed)[0] || [];

    return this.normalizeToolsList(rawList, analysis);
  }

  private async generateWithGemini(analysis: PageAnalysisResult, apiKey: string, model: string): Promise<WebMCPToolDefinition[]> {
    const prompt = `${SYSTEM_PROMPT}

Analyze this page and output WebMCP tools in valid JSON format:
URL: ${analysis.url}
Title: ${analysis.title}
Domain: ${analysis.domain}
Headings: ${JSON.stringify(analysis.headings)}
Forms: ${JSON.stringify(analysis.forms.slice(0, 6))}
Interactive Elements: ${JSON.stringify(analysis.interactiveElements.slice(0, 35))}
Navigation Links: ${JSON.stringify(analysis.navigationLinks.slice(0, 15))}
Content: ${analysis.rawTextSnippet.slice(0, 1500)}

Respond only with JSON: {"tools": [...]}`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      const permanent = res.status === 404 || /NOT_FOUND|not found|not supported/i.test(errBody);
      const err = new ModelNotFoundError(`Gemini API error HTTP ${res.status} (${model}): ${errBody.slice(0, 300)}`);
      if (!permanent) {
        (err as any).permanent = false;
        throw err;
      }
      throw err;
    }

    const data = await res.json() as any;
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsed = JSON.parse(rawText);
    const rawList: any[] = Array.isArray(parsed) ? parsed : parsed.tools || parsed.toolDefinitions || Object.values(parsed)[0] || [];

    return this.normalizeToolsList(rawList, analysis);
  }

  private normalizeToolsList(rawList: any[], analysis: PageAnalysisResult): WebMCPToolDefinition[] {
    if (!Array.isArray(rawList) || rawList.length === 0) return [];

    return rawList.map((t, idx) => ({
      id: t.id || `${analysis.domain}_${t.name || idx}`,
      name: (t.name || `tool_${idx}`).toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      description: t.description || `Execute ${t.name || 'action'} on ${analysis.domain}`,
      inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} },
      annotations: {
        readOnly: Boolean(t.annotations?.readOnly),
        destructive: Boolean(t.annotations?.destructive),
        requiresConfirmation: t.annotations?.requiresConfirmation ?? !Boolean(t.annotations?.readOnly),
        category: t.annotations?.category || 'interaction',
        confidenceScore: t.annotations?.confidenceScore || 0.95,
        sourceDomain: analysis.domain,
        sourceUrl: analysis.url,
      },
      actionRecipe: Array.isArray(t.actionRecipe) ? t.actionRecipe : [],
      status: 'proposed' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      domain: analysis.domain,
    }));
  }

  private generateHeuristicTools(analysis: PageAnalysisResult): WebMCPToolDefinition[] {
    const tools: WebMCPToolDefinition[] = [];
    const domain = analysis.domain;
    const now = new Date().toISOString();

    // 1. Page Content & Headline Extractor
    tools.push({
      id: `${domain}_extract_page_content`,
      name: 'extract_page_content',
      description: `Extract the primary headings, body text, and key summary metadata from ${analysis.title || domain}.`,
      inputSchema: {
        type: 'object',
        properties: {
          includeHeadings: { type: 'boolean', description: 'Whether to include parsed headings' },
          maxCharacters: { type: 'number', description: 'Maximum characters of body content to return' },
        },
        required: [],
      },
      annotations: {
        readOnly: true,
        destructive: false,
        requiresConfirmation: false,
        category: 'data_extraction',
        confidenceScore: 0.98,
        sourceDomain: domain,
        sourceUrl: analysis.url,
      },
      actionRecipe: [
        {
          id: 'step_extract_text',
          type: 'extract_text',
          selector: 'main, article, [role="main"], body',
          description: 'Extract primary text content from container',
        },
      ],
      status: 'proposed',
      createdAt: now,
      updatedAt: now,
      domain,
    });

    // 2. Search Tools (from search forms or search inputs)
    const searchInput = findSearchInput(analysis.interactiveElements);

    if (searchInput) {
      tools.push({
        id: `${domain}_search_site`,
        name: 'search_site',
        description: `Perform a search query on ${domain} using the site search input.`,
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query or keyword to look up' },
          },
          required: ['query'],
        },
        annotations: {
          readOnly: true,
          destructive: false,
          requiresConfirmation: false,
          category: 'search',
          confidenceScore: 0.94,
          sourceDomain: domain,
          sourceUrl: analysis.url,
        },
        actionRecipe: [
          {
            id: 'step_fill_search',
            type: 'fill',
            selector: searchInput.selector,
            dynamicParam: 'query',
            description: `Enter search query into ${searchInput.selector}`,
          },
          {
            id: 'step_press_enter',
            type: 'press',
            key: 'Enter',
            description: 'Submit search by pressing Enter',
            waitForNavigation: true,
          },
          {
            id: 'step_extract_results',
            type: 'extract_text',
            selector: 'main, [role="main"], .search-results, body',
            description: 'Extract rendered search results',
          },
        ],
        status: 'proposed',
        createdAt: now,
        updatedAt: now,
        domain,
      });
    }

    // 3. Navigation Links Extraction
    if (analysis.navigationLinks.length > 0) {
      tools.push({
        id: `${domain}_get_navigation_menu`,
        name: 'get_navigation_menu',
        description: `Retrieve all primary navigation links, categories, and sections available on ${domain}.`,
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
        annotations: {
          readOnly: true,
          destructive: false,
          requiresConfirmation: false,
          category: 'navigation',
          confidenceScore: 0.96,
          sourceDomain: domain,
          sourceUrl: analysis.url,
        },
        actionRecipe: [
          {
            id: 'step_extract_links',
            type: 'extract_links',
            selector: 'nav a, header a, [role="navigation"] a',
            description: 'Extract navigation links with labels and target URLs',
          },
        ],
        status: 'proposed',
        createdAt: now,
        updatedAt: now,
        domain,
      });
    }

    // 4. Form Submission Tools (e.g. newsletter, contact, filtering)
    analysis.forms.forEach((form, idx) => {
      const formFields = form.fields.filter(f => f.type !== 'hidden');
      if (formFields.length === 0) return;

      const properties: Record<string, any> = {};
      const required: string[] = [];
      const recipeSteps: ActionStep[] = [];

      formFields.forEach((field, fIdx) => {
        const paramKey = (field.name || `field_${fIdx}`).replace(/[^a-zA-Z0-9_]/g, '_');
        properties[paramKey] = {
          type: field.type === 'number' ? 'number' : (field.type === 'checkbox' ? 'boolean' : 'string'),
          description: field.label || field.placeholder || `Value for ${field.name}`,
        };
        if (field.required) required.push(paramKey);

        recipeSteps.push({
          id: `step_field_${fIdx}`,
          type: field.type === 'checkbox' ? 'check' : (field.type === 'select-one' ? 'select' : 'fill'),
          selector: field.selector,
          dynamicParam: paramKey,
          description: `Set ${field.label || field.name} to input value`,
        });
      });

      if (form.submitSelector) {
        recipeSteps.push({
          id: `step_submit_form_${idx}`,
          type: 'click',
          selector: form.submitSelector,
          description: 'Click form submit button',
          waitForNavigation: true,
        });
      }

      const formName = (form.purpose || `form_${idx}`).toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const isSensitive = formName.includes('login') || formName.includes('pay') || formName.includes('checkout') || formName.includes('delete') || formName.includes('contact');

      tools.push({
        id: `${domain}_submit_${formName}`,
        name: `submit_${formName}`,
        description: `Fill and submit the ${form.purpose || 'form'} on ${domain}.`,
        inputSchema: {
          type: 'object',
          properties,
          required,
        },
        annotations: {
          readOnly: false,
          destructive: isSensitive,
          requiresConfirmation: true, // Sensitive actions require human confirmation
          category: isSensitive ? 'form_submission' : 'interaction',
          confidenceScore: 0.91,
          sourceDomain: domain,
          sourceUrl: analysis.url,
        },
        actionRecipe: recipeSteps,
        status: 'proposed',
        createdAt: now,
        updatedAt: now,
        domain,
      });
    });

    // 5. Navigate to URL on Domain tool
    tools.push({
      id: `${domain}_navigate_page`,
      name: 'navigate_page',
      description: `Navigate to a specific path or URL on ${domain}.`,
      inputSchema: {
        type: 'object',
        properties: {
          pathOrUrl: { type: 'string', description: 'Relative path (e.g. /pricing) or full URL' },
        },
        required: ['pathOrUrl'],
      },
      annotations: {
        readOnly: true,
        destructive: false,
        requiresConfirmation: false,
        category: 'navigation',
        confidenceScore: 0.99,
        sourceDomain: domain,
        sourceUrl: analysis.url,
      },
      actionRecipe: [
        {
          id: 'step_nav',
          type: 'navigate',
          dynamicParam: 'pathOrUrl',
          description: 'Navigate browser to target destination',
        },
        {
          id: 'step_wait_ready',
          type: 'wait_for',
          selector: 'body',
          description: 'Wait for page ready state',
        },
      ],
      status: 'proposed',
      createdAt: now,
      updatedAt: now,
      domain,
    });

    // 6. Interactive Button Clickers (e.g., CTA, Filter, Toggle)
    const prominentButtons = analysis.interactiveElements.filter(
      e => (e.tagName === 'button' || e.role === 'button') && e.text && e.text.length > 2 && e.text.length < 35
    );

    prominentButtons.slice(0, 4).forEach((btn, bIdx) => {
      const sanitizedName = (btn.text || `action_${bIdx}`).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 30);
      tools.push({
        id: `${domain}_click_${sanitizedName}`,
        name: `click_${sanitizedName}`,
        description: `Trigger the button action: "${btn.text}" on the current view.`,
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
        annotations: {
          readOnly: false,
          destructive: false,
          requiresConfirmation: false,
          category: 'interaction',
          confidenceScore: 0.88,
          sourceDomain: domain,
          sourceUrl: analysis.url,
        },
        actionRecipe: [
          {
            id: 'step_click_btn',
            type: 'click',
            selector: btn.selector,
            description: `Click button "${btn.text}"`,
          },
        ],
        status: 'proposed',
        createdAt: now,
        updatedAt: now,
        domain,
      });
    });

    // 7. Visual Screenshot capture tool
    tools.push({
      id: `${domain}_capture_viewport_screenshot`,
      name: 'capture_viewport_screenshot',
      description: `Take a visual snapshot of the live webpage rendered in the browser.`,
      inputSchema: {
        type: 'object',
        properties: {
          fullPage: { type: 'boolean', description: 'Whether to capture the entire scrollable height' },
        },
        required: [],
      },
      annotations: {
        readOnly: true,
        destructive: false,
        requiresConfirmation: false,
        category: 'data_extraction',
        confidenceScore: 0.99,
        sourceDomain: domain,
        sourceUrl: analysis.url,
      },
      actionRecipe: [
        {
          id: 'step_screenshot',
          type: 'screenshot',
          description: 'Capture viewport image',
        },
      ],
      status: 'proposed',
      createdAt: now,
      updatedAt: now,
      domain,
    });

    return tools;
  }
}

export const llmToolGenerator = new LLMToolGenerator();
