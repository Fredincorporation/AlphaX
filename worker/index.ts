import type { ActionStep, PageAnalysisResult, ToolExecutionRequest, ToolExecutionResponse, WebMCPToolDefinition } from '../shared/types';
import { LLMToolGenerator } from '../server/llmToolGenerator';
import { analyzePage as renderPage, executeRecipe } from './browser';
import { deleteToolsForDomain, getAllTools, getHistory, getToolsByDomain, saveExecution, saveTools } from './db';
import type { Env } from './env';
import { SessionCoordinator } from './sessionCoordinator';
import { PREBUILT_RECIPES, SAMPLE_TARGETS } from '../server/prebuiltRecipes';

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
    const confirmationResponse = await sessionStub(request, env, sessionId).fetch('https://session/confirm', { method: 'POST', body: JSON.stringify({ id: confirmationId, confirmation }) });
    if (!(await confirmationResponse.json() as { approved: boolean }).approved) {
      return { id: `res_${crypto.randomUUID()}`, requestId: toolRequest.id, toolName: tool.name, status: 'rejected', error: 'Execution cancelled: human confirmation was not approved.', executionTimeMs: Date.now() - started, logs: [], provenance: { targetUrl: tool.annotations.sourceUrl || '', executedStepsCount: 0, confirmedByHuman: false, timestamp: new Date().toISOString(), toolVersion: 'cloudflare-1.0.0' } };
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
      if (url.pathname === '/api/health') return response({ ok: true, runtime: 'cloudflare-workers', uptimeSeconds: 0 }, request, env);
      if (url.pathname === '/api/samples') return response({ samples: SAMPLE_TARGETS }, request, env);

      if (url.pathname === '/api/analyze' && request.method === 'POST') {
        const body = await request.json() as { url?: string };
        if (!body.url) return response({ error: 'Missing required field "url"' }, request, env, 400);
        const targetUrl = allowedUrl(body.url);
        const raw = await renderPage(env, targetUrl);
        const analysis = makeAnalysis(raw, targetUrl);
        const proposedTools = await generateTools(env, analysis);
        return response({ success: true, analysis, proposedTools, approvedTools: await getToolsByDomain(env, analysis.domain), domain: analysis.domain }, request, env);
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
        const result = await executeTool(request, env, body.sessionId || 'default', body.tool, body.request);
        return response(result, request, env);
      }

      if (url.pathname === '/api/history' && request.method === 'GET') {
        return response({ logs: await getHistory(env, url.searchParams.get('domain') || undefined, Number(url.searchParams.get('limit') || 50)) }, request, env);
      }

      return response({ error: 'Not found' }, request, env, 404);
    } catch (error) {
      return response({ error: error instanceof Error ? error.message : 'Worker request failed' }, request, env, 500);
    }
  },
};
