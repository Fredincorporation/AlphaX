import { create } from 'zustand';
import {
  PageAnalysisResult,
  WebMCPToolDefinition,
  ToolExecutionResponse,
  ExecutionLogEntry,
  ConfirmationRequest,
  ToolExecutionRequest
} from '@shared/types';
import { webmcpBridge } from '../lib/webmcpBridge';
import { WS_BASE, apiUrl } from '../lib/api';

export interface ToastNotification {
  id: string;
  type: 'info' | 'success' | 'warn' | 'error';
  title?: string;
  message: string;
  duration?: number;
}

export interface AlertDialogConfig {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel?: () => void;
}

export interface MediatorState {
  // Theme info
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;

  // Session info
  sessionId: string;
  targetUrl: string;
  currentDomain: string;
  status: 'idle' | 'navigating' | 'analyzing' | 'generating' | 'ready' | 'executing' | 'error';
  statusMessage: string;
  supervisionMode: 'strict' | 'supervised' | 'autonomous';

  // Analysis & Tools
  analysis: PageAnalysisResult | null;
  proposedTools: WebMCPToolDefinition[];
  approvedTools: WebMCPToolDefinition[];
  selectedTool: WebMCPToolDefinition | null;

  // Browser telemetry
  liveScreenshot: string | null;
  isLiveStreaming: boolean;

  // Execution & Supervision
  activeExecutionTool: string | null;
  executionLogs: ExecutionLogEntry[];
  recentResults: ToolExecutionResponse[];
  pendingConfirmation: ConfirmationRequest | null;
  auditHistory: any[];

  // Agent Simulator
  agentGoal: string;
  isAgentRunning: boolean;

  // Toasts & UI Alerts
  toasts: ToastNotification[];
  alertDialog: AlertDialogConfig | null;

  // Actions
  setTargetUrl: (url: string) => void;
  setSupervisionMode: (mode: 'strict' | 'supervised' | 'autonomous') => void;
  setSelectedTool: (tool: WebMCPToolDefinition | null) => void;
  setAgentGoal: (goal: string) => void;
  analyzeUrl: (url?: string) => Promise<void>;
  approveTool: (toolId: string) => Promise<void>;
  approveAllTools: () => Promise<void>;
  rejectTool: (toolId: string) => void;
  updateToolDefinition: (tool: WebMCPToolDefinition) => void;
  executeTool: (tool: WebMCPToolDefinition, params: Record<string, any>, origin?: 'webmcp-agent' | 'playground' | 'human-tester') => Promise<ToolExecutionResponse | null>;
  executeToolInternal: (tool: WebMCPToolDefinition, params: Record<string, any>, origin?: 'webmcp-agent' | 'playground' | 'human-tester') => Promise<ToolExecutionResponse | null>;
  respondToConfirmation: (confirmationId: string, approved: boolean) => void;
  revokeDomainTools: (domain?: string) => Promise<void>;
  fetchAuditHistory: () => Promise<void>;
  clearLogs: () => void;
  setLiveScreenshot: (b64: string) => void;
  addToast: (toast: Omit<ToastNotification, 'id'>) => string;
  removeToast: (id: string) => void;
  openAlertDialog: (config: Omit<AlertDialogConfig, 'isOpen'>) => void;
  closeAlertDialog: () => void;
}

let ws: WebSocket | null = null;
let wsPingTimer: any = null;
let activeWsSession: string | null = null;
let executionQueue = Promise.resolve();
let wsReconnectTimer: any = null;
let wsReconnectAttempt = 0;
let wsIntentionalClose = false;

const WS_MAX_RECONNECT_ATTEMPTS = 10;

function clearWsReconnect() {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  wsReconnectAttempt = 0;
}

function scheduleReconnect(sessionId: string, get: () => MediatorState, set: (fn: Partial<MediatorState> | ((state: MediatorState) => Partial<MediatorState>)) => void) {
  if (wsIntentionalClose || activeWsSession !== sessionId) return;
  if (wsReconnectTimer) return;
  if (wsReconnectAttempt >= WS_MAX_RECONNECT_ATTEMPTS) {
    get().addToast({
      type: 'error',
      title: 'Live Stream Unavailable',
      message: 'Could not re-establish the real-time connection. Run an analysis to retry.',
    });
    return;
  }
  const delay = Math.min(1000 * 2 ** wsReconnectAttempt, 30000);
  wsReconnectAttempt += 1;
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    if (!wsIntentionalClose && activeWsSession === sessionId) {
      setupWebSocket(sessionId, get, set);
    }
  }, delay);
}

function setupWebSocket(sessionId: string, get: () => MediatorState, set: (fn: Partial<MediatorState> | ((state: MediatorState) => Partial<MediatorState>)) => void) {
  // If already connected for this session, don't duplicate
  if (ws && activeWsSession === sessionId && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  if (ws) {
    wsIntentionalClose = true;
    try {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
    } catch { }
    ws = null;
    wsIntentionalClose = false;
  }

  if (wsPingTimer) {
    clearInterval(wsPingTimer);
    wsPingTimer = null;
  }
  clearWsReconnect();

  activeWsSession = sessionId;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const wsUrl = `${WS_BASE || `${protocol}//${host}`}/ws?sessionId=${sessionId}`;

  try {
    const socket = new WebSocket(wsUrl);
    ws = socket;
    let lastPongAt = Date.now();

    socket.onopen = () => {
      if (ws !== socket) return;
      wsReconnectAttempt = 0;
      set({ isLiveStreaming: true });

      // Keepalive ping every 20 seconds to prevent proxy timeout;
      // if a pong is not seen within 60s, treat the socket as dead.
      wsPingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          if (Date.now() - lastPongAt > 60000) {
            try { socket.close(); } catch { }
            return; // onclose will trigger reconnect
          }
          try {
            socket.send(JSON.stringify({ type: 'ping' }));
          } catch { }
        }
      }, 20000);
    };

    socket.onmessage = (event) => {
      if (ws !== socket) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'pong') {
          lastPongAt = Date.now();
        } else if (data.type === 'status_update') {
          set({ status: data.status, statusMessage: data.message });
        } else if (data.type === 'screenshot_update') {
          set({ liveScreenshot: data.screenshotBase64 });
        } else if (data.type === 'execution_log') {
          set((state) => ({ executionLogs: [...state.executionLogs, data.log] }));
        } else if (data.type === 'confirmation_required') {
          set({ pendingConfirmation: data.confirmation });
          get().addToast({
            type: 'warn',
            title: 'Confirmation Gate Triggered',
            message: `Supervision required for "${data.confirmation?.toolName || 'action'}"`,
          });
        }
      } catch (e) {
        // Silently handle transient parse edge cases
      }
    };

    socket.onclose = () => {
      if (ws === socket) {
        ws = null;
        set({ isLiveStreaming: false });
        if (wsPingTimer) {
          clearInterval(wsPingTimer);
          wsPingTimer = null;
        }
        scheduleReconnect(sessionId, get, set);
      }
    };

    socket.onerror = () => {
      if (ws === socket) {
        set({ isLiveStreaming: false });
      }
    };
  } catch (err) {
    // Handled gracefully - retry via reconnect schedule
    scheduleReconnect(sessionId, get, set);
  }
}

export const useMediatorStore = create<MediatorState>((set, get) => {
  // Persist the session across page refreshes so the WebSocket session and
  // server-side execution history are not orphaned.
  const SESSION_STORAGE_KEY = 'alphax-session-id';
  let defaultSessionId: string;
  try {
    defaultSessionId = localStorage.getItem(SESSION_STORAGE_KEY) || '';
    if (!defaultSessionId) {
      defaultSessionId = `session_${Math.random().toString(36).slice(2, 9)}`;
      localStorage.setItem(SESSION_STORAGE_KEY, defaultSessionId);
    }
  } catch {
    defaultSessionId = `session_${Math.random().toString(36).slice(2, 9)}`;
  }
  const initialTheme = (typeof window !== 'undefined' && localStorage.getItem('alphax-theme') === 'light') ? 'light' : 'dark';

  return {
    theme: initialTheme,
    setTheme: (theme: 'dark' | 'light') => {
      if (typeof window !== 'undefined') {
        localStorage.setItem('alphax-theme', theme);
        if (theme === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      }
      set({ theme });
    },
    toggleTheme: () => {
      const current = get().theme;
      const next = current === 'dark' ? 'light' : 'dark';
      get().setTheme(next);
      get().addToast({
        type: 'info',
        title: `${next === 'dark' ? '🌙 Dark Mode' : '☀️ Light Mode'} Activated`,
        message: `Switched theme to ${next} mode.`,
      });
    },

    sessionId: defaultSessionId,
    targetUrl: '',
    currentDomain: '',
    status: 'idle',
    statusMessage: 'Ready to mediate target websites.',
    supervisionMode: 'supervised',

    analysis: null,
    proposedTools: [],
    approvedTools: [],
    selectedTool: null,

    liveScreenshot: null,
    isLiveStreaming: false,

    activeExecutionTool: null,
    executionLogs: [],
    recentResults: [],
    pendingConfirmation: null,
    auditHistory: [],

    agentGoal: 'Find the highest scored tech news story on Hacker News',
    isAgentRunning: false,

    toasts: [],
    alertDialog: null,

    addToast: (toast) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const newToast: ToastNotification = { id, duration: 4000, ...toast };
      set((s) => ({ toasts: [...s.toasts, newToast] }));

      const duration = newToast.duration || 4000;
      setTimeout(() => {
        get().removeToast(id);
      }, duration);

      return id;
    },

    removeToast: (id) => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },

    openAlertDialog: (config) => {
      set({ alertDialog: { ...config, isOpen: true } });
    },

    closeAlertDialog: () => {
      set({ alertDialog: null });
    },

    setTargetUrl: (url: string) => set({ targetUrl: url }),
    setSupervisionMode: (mode) => set({ supervisionMode: mode }),
    setSelectedTool: (tool) => set({ selectedTool: tool }),
    setAgentGoal: (goal) => set({ agentGoal: goal }),
    setLiveScreenshot: (b64: string) => set({ liveScreenshot: b64 }),
    clearLogs: () => set({ executionLogs: [] }),

    analyzeUrl: async (customUrl?: string) => {
      const state = get();
      const rawUrl = (customUrl || state.targetUrl).trim();
      const urlToAnalyze = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : rawUrl ? `https://${rawUrl}` : '';
      if (!urlToAnalyze) return;

      if (urlToAnalyze !== state.targetUrl) set({ targetUrl: urlToAnalyze });

      setupWebSocket(state.sessionId, get, set);

      set({
        status: 'analyzing',
        statusMessage: `Connecting Playwright browser to ${urlToAnalyze}...`,
        executionLogs: [],
        proposedTools: [],
        selectedTool: null,
      });

      try {
        let res: Response | undefined;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            res = await fetch(apiUrl('/api/analyze'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url: urlToAnalyze,
                sessionId: state.sessionId,
              }),
            });
            break;
          } catch (error) {
            if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 1500));
          }
        }

        if (!res) {
          throw new Error(`AlphaX could not reach the backend while analyzing ${urlToAnalyze}. The server may be restarting after a browser crash; please retry in a moment.`);
        }

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to analyze page');

        const approved = (data.approvedTools || []).filter((tool: WebMCPToolDefinition) => tool.status === 'approved');
        const approvedIds = new Set(approved.map((tool: WebMCPToolDefinition) => tool.id));
        const proposed = (data.proposedTools || []).filter((tool: WebMCPToolDefinition) =>
          tool.status !== 'approved' && !approvedIds.has(tool.id)
        );

        set({
          analysis: data.analysis,
          proposedTools: proposed,
          approvedTools: approved,
          currentDomain: data.domain || 'unknown',
          liveScreenshot: data.analysis?.screenshotBase64 || null,
          status: 'ready',
          statusMessage: `Successfully generated ${proposed.length} new WebMCP tools for ${data.domain}`,
        });

        get().addToast({
          type: 'success',
          title: 'Synthesis Complete',
          message: `Synthesized ${proposed.length} new WebMCP tools for ${data.domain}`,
        });

        // Register any already approved tools into WebMCP bridge
        if (data.approvedTools && data.approvedTools.length > 0) {
          for (const tool of data.approvedTools) {
            webmcpBridge.registerTool(tool, async (params) => {
              const res = await get().executeTool(tool, params, 'webmcp-agent');
              return res!;
            });
          }
        }
      } catch (err: any) {
        const message = err.message || 'Failed to inspect website';
        const isAutomationChallenge = /anti-bot challenge|captcha|verify you are human|robot check|access denied|blocking automation|crashed chromium/i.test(message);
        const userMessage = isAutomationChallenge
          ? 'This website is presenting an anti-bot challenge. It cannot be completed in the controlled Chromium window or through a popup.'
          : message;
        set({
          status: 'error',
          statusMessage: isAutomationChallenge ? userMessage : `Analysis failed: ${message}`,
          liveScreenshot: isAutomationChallenge ? null : get().liveScreenshot,
        });
        get().addToast({
          type: 'error',
          title: isAutomationChallenge ? 'Anti-bot Challenge' : 'Analysis Error',
          message: userMessage,
        });
      }
    },

    approveTool: async (toolId: string) => {
      const state = get();
      const tool = state.proposedTools.find(t => t.id === toolId);
      if (!tool) return;

      const updatedTool = { ...tool, status: 'approved' as const };
      const newProposed = state.proposedTools.filter(t => t.id !== toolId);
      const newApproved = [...state.approvedTools.filter(t => t.id !== toolId), updatedTool];

      set({ proposedTools: newProposed, approvedTools: newApproved });

      get().addToast({
        type: 'success',
        title: 'Tool Approved',
        message: `Registered "${updatedTool.name}" on document.modelContext`,
      });

      // Register with WebMCP runtime
      webmcpBridge.registerTool(updatedTool, async (params) => {
        const res = await get().executeTool(updatedTool, params, 'webmcp-agent');
        return res!;
      });

      // Persist to server
      try {
        await fetch(apiUrl('/api/tools/approve'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tools: newApproved,
            domain: state.currentDomain,
          }),
        });
      } catch (e) {
        console.error('Failed to persist tool approval:', e);
      }
    },

    approveAllTools: async () => {
      const state = get();
      if (state.proposedTools.length === 0) return;

      const approvedNow = state.proposedTools.map(t => ({ ...t, status: 'approved' as const }));
      const newApproved = [...state.approvedTools, ...approvedNow];

      set({ proposedTools: [], approvedTools: newApproved });

      get().addToast({
        type: 'success',
        title: 'All Tools Approved',
        message: `Registered ${approvedNow.length} WebMCP tools on document.modelContext`,
      });

      for (const t of approvedNow) {
        webmcpBridge.registerTool(t, async (params) => {
          const res = await get().executeTool(t, params, 'webmcp-agent');
          return res!;
        });
      }

      try {
        await fetch(apiUrl('/api/tools/approve'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tools: newApproved,
            domain: state.currentDomain,
          }),
        });
      } catch (e) {
        console.error('Failed to persist all tools approval:', e);
      }
    },

    rejectTool: (toolId: string) => {
      const tool = get().proposedTools.find((t) => t.id === toolId);
      set((state) => ({
        proposedTools: state.proposedTools.filter(t => t.id !== toolId),
        approvedTools: state.approvedTools.filter(t => t.id !== toolId),
      }));
      webmcpBridge.unregisterTool(tool?.name || toolId);
      get().addToast({
        type: 'info',
        title: 'Tool Discarded',
        message: `Removed tool proposal ${tool ? `"${tool.name}"` : ''}`,
      });
    },

    updateToolDefinition: (updatedTool: WebMCPToolDefinition) => {
      set((state) => ({
        proposedTools: state.proposedTools.map(t => t.id === updatedTool.id ? updatedTool : t),
        approvedTools: state.approvedTools.map(t => t.id === updatedTool.id ? updatedTool : t),
        selectedTool: state.selectedTool?.id === updatedTool.id ? updatedTool : state.selectedTool,
      }));
      get().addToast({
        type: 'success',
        title: 'Tool Definition Saved',
        message: `Updated parameters & recipe for "${updatedTool.name}"`,
      });
    },

    executeTool: async (tool, params, origin = 'playground') => {
      let releaseQueue: () => void = () => undefined;
      const previousExecution = executionQueue;
      executionQueue = new Promise<void>((resolve) => {
        releaseQueue = resolve;
      });
      await previousExecution;

      try {
        return await get().executeToolInternal(tool, params, origin);
      } finally {
        releaseQueue();
      }
    },

    executeToolInternal: async (tool, params, origin = 'playground') => {
      const state = get();
      set({
        activeExecutionTool: tool.name,
        status: 'executing',
        statusMessage: `Executing tool: ${tool.name}...`,
      });

      const execRequest: ToolExecutionRequest = {
        id: `req_${Date.now()}`,
        toolId: tool.id,
        toolName: tool.name,
        parameters: params,
        origin,
        timestamp: new Date().toISOString(),
        requiresConfirmation: !!tool.annotations.requiresConfirmation,
      };

      try {
        const res = await fetch(apiUrl('/api/tools/execute'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: state.sessionId,
            tool,
            request: execRequest,
            supervisionMode: state.supervisionMode,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || `Tool execution failed with HTTP ${res.status}.`);
        }
        const executionResponse = data as ToolExecutionResponse;
        const executionFailed = executionResponse.status !== 'success';
        const isAutomationChallenge = /anti-bot challenge|captcha|validateCaptcha|verify you are human|robot check|access denied/i.test(executionResponse.error || '');

        set((s) => ({
          activeExecutionTool: null,
          status: executionFailed ? 'error' : 'ready',
          statusMessage: isAutomationChallenge
            ? 'Anti-bot challenge detected. The site cannot be completed in the controlled Chromium window or through a popup.'
            : executionResponse.status === 'success' ? `Tool "${tool.name}" executed successfully!` : `Tool "${tool.name}" ended with status: ${executionResponse.status}`,
          recentResults: [executionResponse, ...s.recentResults.slice(0, 9)],
          liveScreenshot: executionResponse.finalScreenshotBase64 || s.liveScreenshot,
        }));

        get().fetchAuditHistory();

        if (executionResponse.status === 'success') {
          get().addToast({
            type: 'success',
            title: 'Execution Succeeded',
            message: `"${tool.name}" completed in ${data.executionTimeMs}ms`,
          });
        } else if (executionResponse.status === 'rejected') {
          get().addToast({
            type: 'warn',
            title: 'Action Rejected',
            message: 'Human supervisor declined the gated execution request.',
          });
        } else {
          get().addToast({
            type: 'error',
            title: isAutomationChallenge ? 'Anti-bot Challenge' : 'Execution Notice',
            message: isAutomationChallenge
              ? 'This website is blocking automated access. The challenge cannot be completed in the controlled Chromium window or through a popup.'
              : executionResponse.error || `Execution ended with status: ${executionResponse.status}`,
          });
        }

        return executionResponse;
      } catch (err: any) {
        set({
          activeExecutionTool: null,
          status: 'error',
          statusMessage: `Execution error: ${err.message}`,
        });
        get().addToast({
          type: 'error',
          title: 'Execution Error',
          message: err.message || 'Execution failed',
        });
        return null;
      }
    },

    respondToConfirmation: (confirmationId: string, approved: boolean) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'confirmation_response',
          confirmationId,
          approved,
        }));
      }
      set({ pendingConfirmation: null });
    },

    revokeDomainTools: async (domain?: string) => {
      const targetDomain = domain || get().currentDomain;
      try {
        await fetch(apiUrl(`/api/tools/${encodeURIComponent(targetDomain)}`), { method: 'DELETE' });
        webmcpBridge.unregisterAll();
        set({ approvedTools: [], proposedTools: [] });
        get().addToast({
          type: 'warn',
          title: 'Domain Tools Revoked',
          message: `All WebMCP tools for ${targetDomain} have been purged.`,
        });
      } catch (e) {
        console.error('Failed to revoke tools:', e);
        get().addToast({
          type: 'error',
          title: 'Revoke Error',
          message: 'Failed to revoke domain tools.',
        });
      }
    },

    fetchAuditHistory: async () => {
      try {
        const res = await fetch(apiUrl('/api/history?limit=30'));
        const data = await res.json();
        if (data.logs) {
          set({ auditHistory: data.logs });
        }
      } catch (e) { }
    },
  };
});
