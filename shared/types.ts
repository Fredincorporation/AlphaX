/**
 * AlphaX — Universal Agent Mediation Layer (WebMCP) Types
 */

export type ActionType =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'type'
  | 'select'
  | 'check'
  | 'uncheck'
  | 'press'
  | 'hover'
  | 'scroll'
  | 'wait_for'
  | 'extract_text'
  | 'extract_table'
  | 'extract_links'
  | 'extract_attribute'
  | 'screenshot'
  | 'evaluate_js'
  | 'submit_form';

export interface ActionStep {
  id: string;
  type: ActionType;
  selector?: string;
  text?: string;
  value?: string;
  key?: string;
  url?: string;
  description?: string;
  timeoutMs?: number;
  optional?: boolean;
  waitForNavigation?: boolean;
  dynamicParam?: string; // name of parameter in inputSchema that supplies this value
}

export interface WebMCPToolAnnotations {
  readOnly?: boolean;
  destructive?: boolean;
  requiresConfirmation?: boolean;
  category?: 'navigation' | 'data_extraction' | 'search' | 'form_submission' | 'interaction' | 'checkout' | 'account';
  confidenceScore?: number;
  sourceDomain?: string;
  sourceUrl?: string;
}

export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[] | number[];
  default?: any;
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
}

export interface JSONSchemaObject {
  type: 'object';
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
}

export interface WebMCPToolDefinition {
  id: string;
  name: string;
  description: string;
  inputSchema: JSONSchemaObject;
  annotations: WebMCPToolAnnotations;
  actionRecipe: ActionStep[];
  status: 'proposed' | 'approved' | 'rejected' | 'disabled';
  createdAt: string;
  updatedAt: string;
  domain: string;
  humanNotes?: string;
}

export interface PageElementInfo {
  id: string;
  tagName: string;
  type?: string;
  role?: string;
  name?: string;
  placeholder?: string;
  ariaLabel?: string;
  text?: string;
  value?: string;
  href?: string;
  selector: string;
  xpath?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  isVisible: boolean;
  isEnabled: boolean;
  isInteractive: boolean;
  formId?: string;
}

export interface FormInfo {
  id: string;
  action?: string;
  method?: string;
  fields: {
    name?: string;
    type: string;
    label?: string;
    placeholder?: string;
    selector: string;
    required?: boolean;
    defaultValue?: string;
    options?: string[];
  }[];
  submitSelector?: string;
  purpose?: string;
}

export interface PageAnalysisResult {
  url: string;
  title: string;
  domain: string;
  summary: string;
  screenshotBase64?: string;
  interactiveElements: PageElementInfo[];
  forms: FormInfo[];
  headings: string[];
  navigationLinks: { text: string; href: string }[];
  a11yTreeSnippet: string;
  rawTextSnippet: string;
  analyzedAt: string;
}

export interface ExecutionLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success' | 'security';
  message: string;
  stepIndex?: number;
  data?: any;
}

export interface ToolExecutionRequest {
  id: string;
  toolId: string;
  toolName: string;
  parameters: Record<string, any>;
  origin: 'webmcp-agent' | 'playground' | 'human-tester';
  timestamp: string;
  requiresConfirmation: boolean;
}

export interface ConfirmationRequest {
  id: string;
  toolExecutionId: string;
  toolName: string;
  parameters: Record<string, any>;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  impactDescription: string;
  status: 'pending' | 'approved' | 'rejected' | 'modified';
  timestamp: string;
  timeoutSeconds: number;
  approvedParameters?: Record<string, any>;
}

export interface ToolExecutionResponse {
  id: string;
  requestId: string;
  toolName: string;
  status: 'success' | 'error' | 'rejected' | 'cancelled';
  result?: any;
  error?: string;
  executionTimeMs: number;
  logs: ExecutionLogEntry[];
  finalScreenshotBase64?: string;
  provenance: {
    targetUrl: string;
    executedStepsCount: number;
    confirmedByHuman: boolean;
    timestamp: string;
    toolVersion: string;
  };
}

export interface MediationSessionState {
  sessionId: string;
  targetUrl: string;
  domain: string;
  status: 'idle' | 'analyzing' | 'ready' | 'executing' | 'paused' | 'waiting_confirmation' | 'error';
  currentPageTitle?: string;
  currentScreenshotBase64?: string;
  proposedTools: WebMCPToolDefinition[];
  approvedTools: WebMCPToolDefinition[];
  activeExecutions: ToolExecutionRequest[];
  pendingConfirmation?: ConfirmationRequest;
  history: ToolExecutionResponse[];
  logs: ExecutionLogEntry[];
  supervisionMode: 'strict' | 'supervised' | 'autonomous';
}
