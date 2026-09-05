import type { JSONSchemaObject } from '../shared/types';

export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: unknown;
}

export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface MCPTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: JSONSchemaObject;
  annotations: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    category?: string;
    requiresConfirmation?: boolean;
    confidenceScore?: number;
  };
}

export type MCPContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface MCPSessionState {
  clientInfo?: { name?: string; version?: string };
  protocolVersion?: string;
  initialized: boolean;
}
