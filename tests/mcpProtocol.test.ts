import assert from 'node:assert/strict';
import test from 'node:test';
import { McpEndpoint } from '../worker/mcp';
import type { WebMCPToolDefinition } from '../shared/types';

function makeEnv(tools: WebMCPToolDefinition[]) {
  const rows = tools.map((t) => ({
    id: t.id,
    name: t.name,
    domain: t.domain,
    description: t.description,
    input_schema: JSON.stringify(t.inputSchema),
    annotations: JSON.stringify(t.annotations),
    action_recipe: JSON.stringify(t.actionRecipe),
    status: t.status,
    human_notes: null,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  }));
  return {
    DB: {
      prepare(sql: string) {
        const all = async () => ({ results: sql.includes('ORDER BY domain, name') ? rows : [] });
        const first = async () => rows[0] ?? null;
        return {
          bind(..._args: unknown[]) {
            return { all, first };
          },
          all,
          first,
        };
      },
      async batch() { return []; },
    },
    SESSIONS: {
      idFromName: (n: string) => n,
      get: () => ({
        async fetch(url: string, init: RequestInit) {
          // Simulated gate: always approve instantly (no humans in unit tests).
          return new Response(JSON.stringify({ verdict: 'approved' }), { status: 200 });
        },
      }),
    },
  } as unknown as never;
}

const readTool: WebMCPToolDefinition = {
  id: 'tool_1',
  name: 'example_read_headings',
  description: 'Reads headings',
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnly: true, sourceUrl: 'https://example.com' },
  actionRecipe: [{ id: 's1', type: 'extract_text', selector: 'h1' }],
  status: 'approved',
  createdAt: '', updatedAt: '', domain: 'example.com',
};

function mcpRequest(method: string, params?: unknown, id: string | number = 1): Request {
  return new Request('https://worker/mcp', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
}

test('initialize handshake returns protocol version and capabilities', async () => {
  const res = await new McpEndpoint(makeEnv([])).handle(mcpRequest('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'test', version: '0' } }));
  const body = await res.json() as any;
  assert.equal(body.result.protocolVersion, '2025-06-18');
  assert.ok(body.result.capabilities.tools);
  assert.equal(body.result.serverInfo.name, 'alphax-mediator');
});

test('invalid JSON gets a parse error', async () => {
  const res = await new McpEndpoint(makeEnv([])).handle(new Request('https://worker/mcp', { method: 'POST', body: 'not json' }));
  const body = await res.json() as any;
  assert.equal(body.error.code, -32700);
});

test('unknown method gets method-not-found', async () => {
  const res = await new McpEndpoint(makeEnv([])).handle(mcpRequest('resources/subscribe'));
  const body = await res.json() as any;
  assert.equal(body.error.code, -32601);
});

test('tools/list exposes approved tools with verified hints', async () => {
  const res = await new McpEndpoint(makeEnv([readTool])).handle(mcpRequest('tools/list'));
  const body = await res.json() as any;
  assert.equal(body.result.tools.length, 1);
  assert.equal(body.result.tools[0].name, 'example_read_headings');
  assert.equal(body.result.tools[0].annotations.readOnlyHint, true);
});

test('tools/call with unknown tool is an invalid-params error', async () => {
  // first() returns null when there are no rows
  const env = makeEnv([]);
  const res = await new McpEndpoint(env).handle(mcpRequest('tools/call', { name: 'missing_tool' }));
  const body = await res.json() as any;
  assert.equal(body.error.code, -32602);
});

test('resources/read returns the history resource', async () => {
  const res = await new McpEndpoint(makeEnv([])).handle(mcpRequest('resources/read', { uri: 'history://all' }));
  const body = await res.json() as any;
  assert.equal(body.result.contents[0].uri, 'history://all');
  assert.deepEqual(JSON.parse(body.result.contents[0].text), []);
});
