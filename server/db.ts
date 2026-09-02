import { WebMCPToolDefinition, ToolExecutionResponse } from '../shared/types.js';
import { supabaseServer, isServerSupabaseConfigured } from './supabaseServer.js';
import { PREBUILT_RECIPES } from './prebuiltRecipes.js';

export interface DomainRecord {
  id: string;
  domain: string;
  title?: string;
  favicon_url?: string;
  last_analyzed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface SavedToolRecord {
  id: string;
  name: string;
  domain: string;
  description: string;
  input_schema: any;
  annotations: any;
  action_recipe: any;
  status: 'proposed' | 'approved' | 'rejected' | 'disabled';
  version: number;
  human_notes?: string;
  created_at: string;
  updated_at: string;
}

export interface ToolExecutionRecord {
  id: string;
  session_id: string;
  tool_id?: string;
  tool_name: string;
  domain: string;
  origin: 'webmcp-agent' | 'playground' | 'human-tester';
  status: 'success' | 'error' | 'rejected' | 'cancelled';
  request_params: any;
  result?: any;
  error?: string;
  execution_time_ms: number;
  confirmed_by_human: boolean;
  screenshot_base64?: string;
  created_at: string;
}

export interface AuditLogRecord {
  id: string;
  session_id?: string;
  execution_id?: string;
  level: 'info' | 'warn' | 'error' | 'success' | 'security';
  message: string;
  step_index?: number;
  data?: any;
  created_at: string;
}

export class SupabasePersistenceStore {
  // In-memory cache & fallback store for zero-latency local operations
  private memoryDomains: Map<string, DomainRecord> = new Map();
  private memoryTools: Map<string, WebMCPToolDefinition> = new Map();
  private memoryExecutions: ToolExecutionRecord[] = [];
  private memoryAuditLogs: AuditLogRecord[] = [];
  private isInitialized = false;

  constructor() {
    this.init();
  }

  private async init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Seed in-memory recipes first
    this.seedLocalRecipes();

    // If Supabase is connected, sync prebuilt recipes into Supabase
    if (isServerSupabaseConfigured && supabaseServer) {
      try {
        await this.syncPrebuiltRecipesToSupabase();
        await this.hydrateFromSupabase();
      } catch (err) {
        console.warn('⚠️ [AlphaX Persistence] Notice syncing with Supabase (operating in resilient cache mode):', err);
      }
    } else {
      console.log('ℹ️ [AlphaX Persistence] Running with in-memory persistence layer. Connect Supabase via .env for persistent cloud storage.');
    }
  }

  private seedLocalRecipes() {
    for (const [domain, tools] of Object.entries(PREBUILT_RECIPES)) {
      if (!this.memoryDomains.has(domain)) {
        this.memoryDomains.set(domain, {
          id: `dom_${domain.replace(/[^a-zA-Z0-9]/g, '_')}`,
          domain,
          title: domain,
          last_analyzed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      for (const tool of tools) {
        this.memoryTools.set(tool.id, { ...tool });
      }
    }
  }

  private async syncPrebuiltRecipesToSupabase() {
    if (!supabaseServer) return;

    for (const [domain, tools] of Object.entries(PREBUILT_RECIPES)) {
      // Upsert domain
      await supabaseServer.from('domains').upsert(
        {
          id: `dom_${domain.replace(/[^a-zA-Z0-9]/g, '_')}`,
          domain,
          title: domain,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'domain' }
      );

      // Upsert tools
      const toolRows = tools.map((t) => ({
        id: t.id,
        name: t.name,
        domain: t.domain,
        description: t.description,
        input_schema: t.inputSchema,
        annotations: t.annotations,
        action_recipe: t.actionRecipe,
        status: t.status,
        version: 1,
        human_notes: t.humanNotes || null,
        updated_at: new Date().toISOString(),
      }));

      await supabaseServer.from('saved_tools').upsert(toolRows, { onConflict: 'id' });
    }
  }

  private async hydrateFromSupabase() {
    if (!supabaseServer) return;

    const { data: remoteTools } = await supabaseServer.from('saved_tools').select('*');
    if (remoteTools && remoteTools.length > 0) {
      for (const row of remoteTools) {
        const tool: WebMCPToolDefinition = {
          id: row.id,
          name: row.name,
          description: row.description,
          domain: row.domain,
          inputSchema: row.input_schema,
          annotations: row.annotations,
          actionRecipe: row.action_recipe,
          status: row.status,
          humanNotes: row.human_notes || undefined,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
        this.memoryTools.set(tool.id, tool);
      }
    }
  }

  async saveDomain(domain: string, title?: string, faviconUrl?: string): Promise<void> {
    const record: DomainRecord = {
      id: `dom_${domain.replace(/[^a-zA-Z0-9]/g, '_')}`,
      domain,
      title: title || domain,
      favicon_url: faviconUrl,
      last_analyzed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.memoryDomains.set(domain, record);

    if (supabaseServer) {
      try {
        await supabaseServer.from('domains').upsert(record, { onConflict: 'domain' });
      } catch (e) {
        console.warn('Failed to upsert domain in Supabase:', e);
      }
    }
  }

  async saveTool(tool: WebMCPToolDefinition): Promise<void> {
    this.memoryTools.set(tool.id, { ...tool });

    if (supabaseServer) {
      try {
        // Ensure domain exists
        await this.saveDomain(tool.domain);

        await supabaseServer.from('saved_tools').upsert(
          {
            id: tool.id,
            name: tool.name,
            domain: tool.domain,
            description: tool.description,
            input_schema: tool.inputSchema,
            annotations: tool.annotations,
            action_recipe: tool.actionRecipe,
            status: tool.status,
            version: 1,
            human_notes: tool.humanNotes || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' }
        );
      } catch (e) {
        console.warn('Failed to persist tool to Supabase:', e);
      }
    }
  }

  async saveTools(tools: WebMCPToolDefinition[]): Promise<void> {
    for (const t of tools) {
      await this.saveTool(t);
    }
  }

  getToolsByDomain(domain: string): WebMCPToolDefinition[] {
    const list: WebMCPToolDefinition[] = [];
    for (const t of this.memoryTools.values()) {
      if (t.domain === domain) {
        list.push(t);
      }
    }
    return list;
  }

  getAllApprovedTools(): WebMCPToolDefinition[] {
    const list: WebMCPToolDefinition[] = [];
    for (const t of this.memoryTools.values()) {
      if (t.status === 'approved') {
        list.push(t);
      }
    }
    return list;
  }

  getAllTools(): WebMCPToolDefinition[] {
    return Array.from(this.memoryTools.values());
  }

  async deleteToolsForDomain(domain: string): Promise<void> {
    for (const [id, tool] of this.memoryTools.entries()) {
      if (tool.domain === domain) {
        this.memoryTools.delete(id);
      }
    }

    if (supabaseServer) {
      try {
        await supabaseServer.from('saved_tools').delete().eq('domain', domain);
      } catch (e) {
        console.warn('Failed to delete tools from Supabase:', e);
      }
    }
  }

  async saveExecutionResponse(
    sessionId: string,
    res: ToolExecutionResponse,
    params: any,
    domain: string,
    origin: 'webmcp-agent' | 'playground' | 'human-tester' = 'playground'
  ): Promise<void> {
    const record: ToolExecutionRecord = {
      id: res.id,
      session_id: sessionId,
      tool_id: res.toolName,
      tool_name: res.toolName,
      domain,
      origin,
      status: res.status,
      request_params: params,
      result: res.result || null,
      error: res.error || undefined,
      execution_time_ms: res.executionTimeMs,
      confirmed_by_human: Boolean(res.provenance?.confirmedByHuman),
      screenshot_base64: res.finalScreenshotBase64 ? res.finalScreenshotBase64.slice(0, 500) : undefined,
      created_at: new Date().toISOString(),
    };

    this.memoryExecutions.unshift(record);
    if (this.memoryExecutions.length > 200) {
      this.memoryExecutions.pop();
    }

    // Save individual step logs
    if (res.logs && res.logs.length > 0) {
      for (const log of res.logs) {
        this.memoryAuditLogs.unshift({
          id: log.id,
          session_id: sessionId,
          execution_id: res.id,
          level: log.level,
          message: log.message,
          step_index: log.stepIndex,
          data: log.data,
          created_at: log.timestamp,
        });
      }
    }

    if (supabaseServer) {
      try {
        await supabaseServer.from('tool_executions').insert(record);

        if (res.logs && res.logs.length > 0) {
          const logRows = res.logs.map((log) => ({
            id: log.id,
            session_id: sessionId,
            execution_id: res.id,
            level: log.level,
            message: log.message,
            step_index: log.stepIndex,
            data: log.data,
            created_at: log.timestamp,
          }));
          await supabaseServer.from('audit_logs').insert(logRows);
        }
      } catch (e) {
        console.warn('Failed to persist execution log to Supabase:', e);
      }
    }
  }

  getExecutionLogs(domain?: string, limit = 50): any[] {
    let list = this.memoryExecutions;
    if (domain) {
      list = list.filter((e) => e.domain === domain);
    }
    return list.slice(0, limit);
  }
}

export const persistenceStore = new SupabasePersistenceStore();
