import type { ActionStep, PageAnalysisResult, ToolExecutionRequest, ToolExecutionResponse, WebMCPToolDefinition } from '../shared/types';
import { LLMToolGenerator } from '../server/llmToolGenerator';
import { analyzePage as renderPage, BrowserRateLimitError, executeRecipe, launchBrowser, toBase64 } from './browser';
import { deleteToolsForDomain, getAllTools, getHistory, getToolsByDomain, saveExecution, saveTools } from './db';
import type { Env } from './env';
import { SessionCoordinator } from './sessionCoordinator';
import { McpEndpoint } from './mcp';
import { PREBUILT_RECIPES, SAMPLE_TARGETS } from '../server/prebuiltRecipes';
import { analyzeStatic } from './staticAnalyzer';
import {
  ANALYSIS_TTL_SECONDS,
  SCREENSHOT_TTL_SECONDS,
  analysisKey,
  getJson,
  isDuplicate,
  putJson,
  releaseDedupe,
  screenshotKey,
} from './cache';

export { SessionCoordinator };

const jsonHeaders = { 'Content-Type': 'application/json' };
let seeded = false;

async function ensureSeeded(env: Env): Promise<void> {
  if (seeded) return;
  await saveTools(env, Object.values(PREBUILT_RECIPES).flat());
  seeded = true;
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGIN || origin || '*';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  };
}

function response(data: unknown, request: Request, env: Env, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...jsonHeaders, ...corsHeaders(request, env) } });
}

function sessionStub(request: Request, env: Env, sessionId: string): DurableObjectStub {
  const id = env.SESSIONS.idFromName(sessionId);
  return env.SESSIONS.get(id);
}

function allowedUrl(value: string, current = 'about:blank'): string {
  const parsed = new URL(value, current === 'about:blank' ? undefined : current);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Navigation requires an HTTP or HTTPS URL.');
  return parsed.toString();
}

function makeAnalysis(raw: Record<string, unknown>, url: string): PageAnalysisResult {
  const domain = new URL(url).hostname;
  return {
    url: String(raw.url || url),
    title: String(raw.title || domain),
    domain,
    summary: `${String(raw.title || domain)} (${domain})`,
    screenshotBase64: raw.screenshotBase64 as string | undefined,
    interactiveElements: (raw.interactiveElements || []) as PageAnalysisResult['interactiveElements'],
    forms: (raw.forms || []) as PageAnalysisResult['forms'],
    headings: (raw.headings || []) as string[],
    navigationLinks: (raw.navigationLinks || []) as PageAnalysisResult['navigationLinks'],
    a11yTreeSnippet: '',
    rawTextSnippet: String(raw.rawTextSnippet || ''),
    analyzedAt: new Date().toISOString(),
  };
}

async function generateTools(env: Env, analysis: PageAnalysisResult): Promise<WebMCPToolDefinition[]> {
  const generator = new LLMToolGenerator();
  if (env.GROQ_API_KEY) generator.setGroqApiKey(env.GROQ_API_KEY);
  if (env.GEMINI_API_KEY) generator.setGeminiApiKey(env.GEMINI_API_KEY);
  return generator.generateTools(analysis);
}

/**
 * Capture a screenshot with a short-TTL cache in front of Browser Rendering.
 * forceLive bypasses the cache (the "show live view" affordance).
 * Returns undefined when the browser itself fails — callers degrade gracefully.
 */
async function captureScreenshotCached(env: Env, url: string, forceLive = false): Promise<string | undefined> {
  const key = screenshotKey(url);
  if (!forceLive) {
    const cached = await getJson<{ screenshotBase64: string }>(env, key);
    if (cached) return cached.screenshotBase64;
  }
  try {
    const browser = await launchBrowser(env);
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      const shot = toBase64(await page.screenshot({ type: 'jpeg', quality: 65 }));
      await putJson(env, key, { screenshotBase64: shot }, SCREENSHOT_TTL_SECONDS);
      return shot;
    } finally {
      await browser.close();
    }
  } catch {
    return undefined; // quota exhausted / navigation blocked — no visual this time
  }
}

async function executeTool(request: Request, env: Env, sessionId: string, tool: WebMCPToolDefinition, toolRequest: ToolExecutionRequest): Promise<ToolExecutionResponse> {
  const started = Date.now();
  const logs: PageAnalysisResult['interactiveElements'] = [];
  const executionId = toolRequest.id || `exec_${crypto.randomUUID()}`;
  const addLog = async (level: string, message: string, stepIndex?: number) => {
    await sessionStub(request, env, sessionId).fetch('https://session/broadcast', {
      method: 'POST', body: JSON.stringify({ type: 'execution_log', log: { id: `${executionId}_${Date.now()}`, timestamp: new Date().toISOString(), level, message, stepIndex } }),
    });
  };

  if (tool.annotations.requiresConfirmation && toolRequest.origin !== 'human-tester') {
    const confirmationId = `conf_${crypto.randomUUID()}`;
    const confirmation = { id: confirmationId, toolExecutionId: executionId, toolName: tool.name, parameters: toolRequest.parameters, riskLevel: tool.annotations.destructive ? 'high' : 'medium', status: 'pending', timestamp: new Date().toISOString(), timeoutSeconds: 60 };
    // Gate relocated into the DO (Phase 1): the verdict is approved/rejected/
    // timeout, and the timeout fails closed inside the coordinator.
    const approvalResponse = await sessionStub(request, env, sessionId).fetch('https://session/request-approval', { method: 'POST', body: JSON.stringify({ id: confirmationId, confirmation }) });
    const { verdict } = await approvalResponse.json() as { verdict: 'approved' | 'rejected' | 'timeout' };
    if (verdict !== 'approved') {
      const reason = verdict === 'timeout'
        ? 'Execution rejected: no human verdict within the 60s confirmation window (fail-closed).'
        : 'Execution cancelled: human confirmation was not approved.';
      return { id: `res_${crypto.randomUUID()}`, requestId: toolRequest.id, toolName: tool.name, status: 'rejected', error: reason, executionTimeMs: Date.now() - started, logs: [], provenance: { targetUrl: tool.annotations.sourceUrl || '', executedStepsCount: 0, confirmedByHuman: false, timestamp: new Date().toISOString(), toolVersion: 'cloudflare-1.0.0' } };
    }
  }

  await addLog('info', `Starting execution of ${tool.name}`);
  const browserResult = await executeRecipe(env, tool, toolRequest.parameters, async (message) => addLog('info', message));
  const result: ToolExecutionResponse = { id: `res_${crypto.randomUUID()}`, requestId: toolRequest.id, toolName: tool.name, status: 'success', result: browserResult.result, executionTimeMs: Date.now() - started, logs: [], finalScreenshotBase64: browserResult.screenshotBase64, provenance: { targetUrl: tool.annotations.sourceUrl || '', executedStepsCount: tool.actionRecipe.length, confirmedByHuman: false, timestamp: new Date().toISOString(), toolVersion: 'cloudflare-1.0.0' } };
  await saveExecution(env, sessionId, result, toolRequest.parameters, tool.domain);
  await addLog('success', `Tool execution completed: ${tool.name}`);
  return result;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });

    if (url.pathname === '/ws') {
      const sessionId = url.searchParams.get('sessionId') || 'default';
      return sessionStub(request, env, sessionId).fetch(request);
    }

    try {
      await ensureSeeded(env);
      if (url.pathname === '/mcp' && request.method === 'POST') {
        // MCP JSON-RPC 2.0 front door (Streamable-HTTP-style single POSTs).
        return new McpEndpoint(env).handle(request);
      }

      if (url.pathname === '/api/health') return response({ ok: true, runtime: 'cloudflare-workers', uptimeSeconds: 0 }, request, env);
      if (url.pathname === '/api/samples') return response({ samples: SAMPLE_TARGETS }, request, env);

      if (url.pathname === '/api/analyze' && request.method === 'POST') {
        const body = await request.json() as { url?: string; forceRegenerate?: boolean; forceLive?: boolean };
        if (!body.url) return response({ error: 'Missing required field "url"' }, request, env, 400);
        const targetUrl = allowedUrl(body.url);
        const domain = new URL(targetUrl).hostname;

        // --- #3 dedupe: collapse true double-clicks (in-flight requests only).
        // Completed analyses never block retries — the cache serves those.
        // If a duplicate arrives but the analysis is already cached, serve the
        // cached result instead of erroring.
        const dedupeId = targetUrl;
        if (isDuplicate(env, 'analyze', dedupeId) && !body.forceRegenerate) {
          const cachedWhileLocked = await getJson<{ analysis: PageAnalysisResult; tools: WebMCPToolDefinition[] }>(env, analysisKey(domain));
          if (cachedWhileLocked) {
            const cachedShot = await captureScreenshotCached(env, targetUrl, Boolean(body.forceLive));
            return response({
              success: true,
              analysis: { ...cachedWhileLocked.analysis, screenshotBase64: cachedShot },
              proposedTools: cachedWhileLocked.tools,
              approvedTools: await getToolsByDomain(env, cachedWhileLocked.analysis.domain),
              domain: cachedWhileLocked.analysis.domain,
              analysisSource: 'cache',
            }, request, env);
          }
          return response({ error: 'Duplicate analyze request for this URL is still in progress. Retry in a few seconds.' }, request, env, 429);
        }

        try {
          // --- #1 analysis cache: skip render + LLM for recently analyzed domains ---
          let analysis: PageAnalysisResult | undefined;
          let proposedTools: WebMCPToolDefinition[] | undefined;
          let analysisSource: 'cache' | 'static' | 'browser' = 'browser';

          if (!body.forceRegenerate) {
            const cached = await getJson<{ analysis: PageAnalysisResult; tools: WebMCPToolDefinition[] }>(env, analysisKey(domain));
            if (cached) {
              analysis = cached.analysis;
              proposedTools = cached.tools;
              analysisSource = 'cache';
            }
          }

          if (!analysis || !proposedTools) {
            // --- #4 static-first: fetch + HTMLRewriter costs zero browser quota ---
            const staticResult = await analyzeStatic(targetUrl);
            if (staticResult.usable) {
              analysis = makeAnalysis(staticResult as unknown as Record<string, unknown>, targetUrl);
              analysisSource = 'static';
            } else {
              console.log(`[analyze] static analysis unusable for ${targetUrl}: ${staticResult.reason} — falling back to browser`);
            }

            if (!analysis) {
              const raw = await renderPage(env, targetUrl);
              analysis = makeAnalysis(raw, targetUrl);
            }
            proposedTools = await generateTools(env, analysis);

            // Only cache full analyses from real renders; static snapshots of
            // volatile pages are re-derived cheaply anyway (no quota cost).
            if (analysisSource === 'browser' || analysisSource === 'static') {
              await putJson(env, analysisKey(domain), { analysis, tools: proposedTools }, ANALYSIS_TTL_SECONDS);
            }
          }

          // --- visual output: cached screenshot, live render on demand ---
          const screenshotBase64 = await captureScreenshotCached(env, targetUrl, Boolean(body.forceLive));
          analysis = { ...analysis, screenshotBase64 };

          return response({ success: true, analysis, proposedTools, approvedTools: await getToolsByDomain(env, analysis.domain), domain: analysis.domain, analysisSource }, request, env);
        } finally {
          releaseDedupe(env, 'analyze', dedupeId);
        }
      }

      if (url.pathname === '/api/tools' && request.method === 'GET') {
        const domain = url.searchParams.get('domain');
        return response({ tools: domain ? await getToolsByDomain(env, domain) : await getAllTools(env) }, request, env);
      }

      if (url.pathname === '/api/tools/approve' && request.method === 'POST') {
        const body = await request.json() as { tools?: WebMCPToolDefinition[]; domain?: string };
        if (!body.tools || !body.domain) return response({ error: 'Missing tools array or domain' }, request, env, 400);
        const tools = body.tools.map((tool) => ({ ...tool, status: 'approved' as const, updatedAt: new Date().toISOString() }));
        await saveTools(env, tools);
        return response({ success: true, count: tools.length, tools }, request, env);
      }

      const domainMatch = url.pathname.match(/^\/api\/tools\/(.+)$/);
      if (domainMatch && request.method === 'DELETE') {
        await deleteToolsForDomain(env, decodeURIComponent(domainMatch[1]));
        return response({ success: true }, request, env);
      }

      if (url.pathname === '/api/tools/execute' && request.method === 'POST') {
        const body = await request.json() as { sessionId?: string; tool?: WebMCPToolDefinition; request?: ToolExecutionRequest };
        if (!body.tool || !body.request) return response({ error: 'Missing tool or request object' }, request, env, 400);

        // --- #3 dedupe: identical execute calls within the window are rejected
        // (double-click protection — each execution burns browser quota) ---
        const execIdentity = `${body.tool.id}:${JSON.stringify(body.request.parameters || {})}`;
        if (isDuplicate(env, 'execute', execIdentity)) {
          return response({ error: 'Duplicate execution request already in progress. Retry in a few seconds.' }, request, env, 429);
        }

        try {
          const result = await executeTool(request, env, body.sessionId || 'default', body.tool, body.request);
          return response(result, request, env);
        } finally {
          releaseDedupe(env, 'execute', execIdentity);
        }
      }

      if (url.pathname === '/api/history' && request.method === 'GET') {
        return response({ logs: await getHistory(env, url.searchParams.get('domain') || undefined, Number(url.searchParams.get('limit') || 50)) }, request, env);
      }

      return response({ error: 'Not found' }, request, env, 404);
    } catch (error) {
      // Surface quota exhaustion as 429 so clients can offer "retry later"
      // instead of treating it as a server fault (500).
      if (error instanceof BrowserRateLimitError) {
        return response({ error: error.message }, request, env, 429);
      }
      return response({ error: error instanceof Error ? error.message : 'Worker request failed' }, request, env, 500);
    }
  },
};
