import type { WebMCPToolDefinition, ToolExecutionResponse } from '../shared/types';
import type { Env } from './env';

const MAX_CACHED_VALUE_LENGTH = 20000;

function safeJson(value: unknown, fallback = '{}'): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? fallback : serialized;
  } catch {
    return fallback;
  }
}

function cachedJson(value: unknown): string {
  const serialized = safeJson(value);
  return serialized.length <= MAX_CACHED_VALUE_LENGTH
    ? serialized
    : `${serialized.slice(0, MAX_CACHED_VALUE_LENGTH)}... [truncated]`;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function rowToTool(row: Record<string, unknown>): WebMCPToolDefinition {
  return {
    id: String(row.id),
    name: String(row.name),
    domain: String(row.domain),
    description: String(row.description),
    inputSchema: parseJson(row.input_schema as string, { type: 'object', properties: {} }),
    annotations: parseJson(row.annotations as string, {}),
    actionRecipe: parseJson(row.action_recipe as string, []),
    status: row.status as WebMCPToolDefinition['status'],
    humanNotes: row.human_notes ? String(row.human_notes) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function getToolsByDomain(env: Env, domain: string): Promise<WebMCPToolDefinition[]> {
  const result = await env.DB.prepare('SELECT * FROM saved_tools WHERE domain = ? ORDER BY name')
    .bind(domain).all<Record<string, unknown>>();
  return result.results.map(rowToTool);
}

export async function getAllTools(env: Env): Promise<WebMCPToolDefinition[]> {
  const result = await env.DB.prepare('SELECT * FROM saved_tools ORDER BY domain, name')
    .all<Record<string, unknown>>();
  return result.results.map(rowToTool);
}

export async function saveTools(env: Env, tools: WebMCPToolDefinition[]): Promise<void> {
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const tool of tools) {
    statements.push(env.DB.prepare(`
      INSERT INTO domains (id, domain, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(domain) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at
    `).bind(`dom_${tool.domain.replace(/[^a-zA-Z0-9]/g, '_')}`, tool.domain, tool.domain, now, now));
    statements.push(env.DB.prepare(`
      INSERT INTO saved_tools (id, name, domain, description, input_schema, annotations, action_recipe, status, version, human_notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM saved_tools WHERE id = ?), ?), ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, domain = excluded.domain, description = excluded.description,
        input_schema = excluded.input_schema, annotations = excluded.annotations, action_recipe = excluded.action_recipe,
        status = excluded.status, version = excluded.version, human_notes = excluded.human_notes, updated_at = excluded.updated_at
    `).bind(
      tool.id, tool.name, tool.domain, tool.description, safeJson(tool.inputSchema), safeJson(tool.annotations),
      safeJson(tool.actionRecipe), tool.status, 1, tool.humanNotes || null, tool.id, now, now
    ));
  }
  if (statements.length > 0) await env.DB.batch(statements);
}

export async function deleteToolsForDomain(env: Env, domain: string): Promise<void> {
  await env.DB.prepare('DELETE FROM saved_tools WHERE domain = ?').bind(domain).run();
}

export async function saveExecution(env: Env, sessionId: string, response: ToolExecutionResponse, params: Record<string, unknown>, domain: string): Promise<void> {
  const createdAt = new Date().toISOString();
  const execution = env.DB.prepare(`
    INSERT OR REPLACE INTO tool_executions
      (id, session_id, tool_id, tool_name, domain, origin, status, request_params, result, error, execution_time_ms, confirmed_by_human, screenshot_base64, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    response.id, sessionId, response.toolName, response.toolName, domain, 'playground', response.status,
    cachedJson(params), cachedJson(response.result), response.error || null, response.executionTimeMs,
    response.provenance.confirmedByHuman ? 1 : 0, response.finalScreenshotBase64?.slice(0, 500) || null, createdAt
  );
  const logs = response.logs.map((log) => env.DB.prepare(`
    INSERT OR REPLACE INTO audit_logs (id, session_id, execution_id, level, message, step_index, data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(log.id, sessionId, response.id, log.level, log.message, log.stepIndex ?? null, cachedJson(log.data), log.timestamp));
  await env.DB.batch([execution, ...logs]);
}

export async function getHistory(env: Env, domain?: string, limit = 50): Promise<Record<string, unknown>[]> {
  const boundedLimit = Math.max(1, Math.min(100, limit));
  const query = domain
    ? env.DB.prepare('SELECT * FROM tool_executions WHERE domain = ? ORDER BY created_at DESC LIMIT ?').bind(domain, boundedLimit)
    : env.DB.prepare('SELECT * FROM tool_executions ORDER BY created_at DESC LIMIT ?').bind(boundedLimit);
  const result = await query.all<Record<string, unknown>>();
  return result.results.map((row) => ({
    ...row,
    request_params: parseJson(row.request_params as string, {}),
    result: parseJson(row.result as string, null),
  }));
}
