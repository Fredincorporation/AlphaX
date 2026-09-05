import type {
  JSONRPCRequest,
  JSONRPCResponse,
  MCPSessionState,
  MCPTool,
  MCPContentBlock,
} from './mcpTypes';
import { getAllTools, getHistory, getToolById, saveExecution } from './db';
import type { Env } from './env';
import { BrowserRateLimitError, executeRecipe } from './browser';
import { verifyAnnotations } from './annotationVerifier';
import type { ToolExecutionResponse, WebMCPToolDefinition } from '../shared/types';

const SUPPORTED_PROTOCOL_VERSION = '2025-06-18';
const JSONRPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;
const CONFIRMATION_TIMEOUT = -32001; // fail-closed on missed human verdict
const NOT_INITIALIZED = -32002;

function jsonRpcResponse(id: JSONRPCRequest['id'], result: unknown): JSONRPCResponse {
  return { jsonrpc: '2.0', id, result };
}
function jsonRpcError(id: JSONRPCRequest['id'], code: number, message: string): JSONRPCResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function toMcpTool(tool: WebMCPToolDefinition): MCPTool {
  const verified = verifyAnnotations(tool);
  return {
    name: tool.name,
    title: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      title: tool.name,
      readOnlyHint: verified.readOnly,
      destructiveHint: verified.destructive,
      idempotentHint: verified.readOnly,
      openWorldHint: true,
      category: tool.annotations.category,
      requiresConfirmation: tool.annotations.requiresConfirmation,
      confidenceScore: tool.annotations.confidenceScore,
    },
  };
}

export class McpEndpoint {
  constructor(private readonly env: Env) {}

  /**
   * Single entry point: parse a JSON-RPC request and route it.
   * Never throws — always returns a JSON-RPC response envelope.
   */
  async handle(request: Request): Promise<Response> {
    let body: JSONRPCRequest;
    try {
      body = await request.json() as JSONRPCRequest;
    } catch {
      return Response.json(jsonRpcError(null, JSONRPC_ERROR_CODES.PARSE_ERROR, 'Invalid JSON body.'), { status: 400 });
    }
    if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      return Response.json(jsonRpcError(body?.id ?? null, JSONRPC_ERROR_CODES.INVALID_REQUEST, 'Not a valid JSON-RPC 2.0 request.'), { status: 400 });
    }
    try {
      const result = await this.dispatch(body);
      return Response.json(jsonRpcResponse(body.id, result));
    } catch (error) {
      if (error instanceof McpProtocolError) {
        return Response.json(jsonRpcError(body.id, error.code, error.message));
      }
      if (error instanceof BrowserRateLimitError) {
        return Response.json(jsonRpcError(body.id, JSONRPC_ERROR_CODES.INTERNAL_ERROR, error.message));
      }
      return Response.json(jsonRpcError(body.id, JSONRPC_ERROR_CODES.INTERNAL_ERROR, error instanceof Error ? error.message : 'Internal MCP error.'));
    }
  }

  private async dispatch(request: JSONRPCRequest): Promise<unknown> {
    switch (request.method) {
      case 'initialize': return this.initialize(request.params as MCPSessionState['clientInfo'] & { protocolVersion?: string; capabilities?: unknown });
      case 'notifications/initialized': return {}; // notification — no result body expected
      case 'ping': return {};
      case 'tools/list': return this.toolsList();
      case 'tools/call': return this.toolsCall(request.params as { name?: string; arguments?: Record<string, unknown> }, request);
      case 'resources/list': return this.resourcesList();
      case 'resources/read': return this.resourcesRead(request.params as { uri?: string });
      default:
        throw new McpProtocolError(JSONRPC_ERROR_CODES.METHOD_NOT_FOUND, `Method not supported: ${request.method}`);
    }
  }

  private async initialize(params: { protocolVersion?: string } | undefined) {
    const requested = params?.protocolVersion;
    const protocolVersion = requested === '2024-11-05' || requested === '2025-03-26' || requested === '2025-06-18'
      ? requested
      : SUPPORTED_PROTOCOL_VERSION;
    return {
      protocolVersion,
      capabilities: {
        tools: { listChanged: false },
        resources: { subscribe: false },
        elicitation: {},
      },
      serverInfo: { name: 'alphax-mediator', version: '1.0.0' },
      instructions: 'Browser automation tools discovered and supervised by AlphaX. Destructive calls require a human verdict within 60 seconds or they fail closed.',
    };
  }

  private async toolsList() {
    const tools = await getAllTools(this.env);
    return { tools: tools.filter((t) => t.status === 'approved').map(toMcpTool) };
  }

  private async toolsCall(params: { name?: string; arguments?: Record<string, unknown> }, request: JSONRPCRequest) {
    if (!params?.name) {
      throw new McpProtocolError(JSONRPC_ERROR_CODES.INVALID_PARAMS, 'tools/call requires a "name".');
    }
    // SECURITY: the tool is looked up server-side by name so a client can
    // never smuggle its own actionRecipe past the supervision gate.
    const tool = await getToolById(this.env, params.name);
    if (!tool || tool.status !== 'approved') {
      throw new McpProtocolError(JSONRPC_ERROR_CODES.INVALID_PARAMS, `Tool "${params.name}" not found or not approved.`);
    }

    const verified = verifyAnnotations(tool);
    // Phase 3 gate: verified (not LLM-claimed) annotations drive supervision.
    if (verified.requiresConfirmation) {
      const confirmationId = `mcp_conf_${crypto.randomUUID()}`;
      const confirmation = {
        id: confirmationId,
        toolExecutionId: `mcp_${String(request.id)}`,
        toolName: tool.name,
        parameters: params.arguments || {},
        riskLevel: verified.destructive ? 'high' : 'medium',
        status: 'pending',
        timestamp: new Date().toISOString(),
        timeoutSeconds: 60,
      };
      const stub = this.sessionStub();
      const approvalResponse = await stub.fetch('https://session/request-approval', {
        method: 'POST',
        body: JSON.stringify({ id: confirmationId, confirmation }),
      });
      const { verdict } = await approvalResponse.json() as { verdict: 'approved' | 'rejected' | 'timeout' };
      if (verdict !== 'approved') {
        const message = verdict === 'timeout'
          ? 'Confirmation timed out after 60s with no human verdict — request rejected (fail-closed).'
          : 'Human rejected this tool call.';
        throw new McpProtocolError(CONFIRMATION_TIMEOUT, message);
      }
    }

    const execution = await this.execute(tool, params.arguments || {});
    return this.toCallToolResult(execution);
  }

  private sessionStub(): DurableObjectStub {
    // One MCP session = one mediation session = one Durable Object instance,
    // so the gate and execution live in the same single-threaded actor.
    const id = this.env.SESSIONS.idFromName('default');
    return this.env.SESSIONS.get(id);
  }

  private async execute(tool: WebMCPToolDefinition, parameters: Record<string, unknown>): Promise<ToolExecutionResponse> {
    const started = Date.now();
    const executionId = `mcp_exec_${crypto.randomUUID()}`;
    const logs: ToolExecutionResponse['logs'] = [];
    const browserResult = await executeRecipe(
      this.env,
      tool,
      parameters,
      async (message) => { logs.push({ id: `${executionId}_${logs.length}`, timestamp: new Date().toISOString(), level: 'info', message }); },
    );
    const response: ToolExecutionResponse = {
      id: executionId,
      requestId: executionId,
      toolName: tool.name,
      status: 'success',
      result: browserResult.result,
      executionTimeMs: Date.now() - started,
      logs,
      finalScreenshotBase64: browserResult.screenshotBase64,
      provenance: {
        targetUrl: tool.annotations.sourceUrl || '',
        executedStepsCount: tool.actionRecipe.length,
        confirmedByHuman: false,
        timestamp: new Date().toISOString(),
        toolVersion: 'cloudflare-1.0.0',
      },
    };
    await saveExecution(this.env, 'mcp', response, parameters, tool.domain);
    return response;
  }

  private toCallToolResult(execution: ToolExecutionResponse) {
    const content: MCPContentBlock[] = [{ type: 'text', text: JSON.stringify(execution.result ?? {}, null, 2) }];
    if (execution.finalScreenshotBase64) {
      content.push({ type: 'image', data: execution.finalScreenshotBase64, mimeType: 'image/jpeg' });
    }
    return {
      content,
      isError: execution.status === 'error',
      structuredContent: {
        status: execution.status,
        executionTimeMs: execution.executionTimeMs,
        provenance: execution.provenance,
      },
    };
  }

  private async resourcesList() {
    return {
      resources: [
        {
          uri: 'history://all',
          name: 'Tool execution history',
          description: 'Recent tool executions across all sessions (the audit trail).',
          mimeType: 'application/json',
        },
      ],
    };
  }

  private async resourcesRead(params: { uri?: string }) {
    if (params?.uri === 'history://all') {
      const history = await getHistory(this.env, undefined, 100);
      return {
        contents: [{ uri: params.uri, mimeType: 'application/json', text: JSON.stringify(history, null, 2) }],
      };
    }
    throw new McpProtocolError(JSONRPC_ERROR_CODES.INVALID_PARAMS, `Unknown resource: ${params?.uri}`);
  }
}

export class McpProtocolError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
    this.name = 'McpProtocolError';
  }
}
