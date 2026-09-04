import { WebMCPToolDefinition, ToolExecutionResponse, ToolExecutionRequest } from '@shared/types';

declare global {
  interface Window {
    modelContext?: {
      registerTool?: (tool: any) => void;
      unregisterTool?: (toolName: string) => void;
      getRegisteredTools?: () => any[];
    };
  }
  interface Document {
    modelContext?: {
      registerTool?: (tool: any) => void;
      unregisterTool?: (toolName: string) => void;
      getRegisteredTools?: () => any[];
    };
  }
  interface Navigator {
    modelContext?: {
      registerTool?: (tool: any) => void;
      unregisterTool?: (toolName: string) => void;
      getRegisteredTools?: () => any[];
    };
  }
}

export interface RegisteredToolHandle {
  id: string;
  name: string;
  definition: WebMCPToolDefinition;
  unregister: () => void;
}

class WebMCPBridge {
  private registeredTools: Map<string, WebMCPToolDefinition> = new Map();
  private executors: Map<string, (params: any) => Promise<ToolExecutionResponse>> = new Map();
  private listeners: Set<(tools: WebMCPToolDefinition[]) => void> = new Set();
  public isNativeWebMCPAvailable = false;

  constructor() {
    this.detectNativeSupport();
    this.setupPolyfill();
    this.exposeDebugProbe();
  }

  /** Test hook: lets scripts/webmcp-flag-test.mjs inspect bridge state. */
  private exposeDebugProbe() {
    if (typeof window === 'undefined') return;
    (window as any).__alphaxWebMCPProbe = () => ({
      isNativeWebMCPAvailable: this.isNativeWebMCPAvailable,
      registeredTools: this.getRegisteredTools().map((t) => t.name),
    });
    (window as any).__alphaxNativeDetected = this.isNativeWebMCPAvailable;
  }

  private detectNativeSupport() {
    if (
      typeof window !== 'undefined' &&
      ((navigator as any).modelContext || window.modelContext || (document && document.modelContext))
    ) {
      this.isNativeWebMCPAvailable = true;
      console.log('⚡ [AlphaX WebMCP Bridge] Native WebMCP detected in browser context!');
    } else {
      this.isNativeWebMCPAvailable = false;
      console.log('ℹ️ [AlphaX WebMCP Bridge] Initializing WebMCP Universal Bridge (Polyfill & Native runtime compatibility mode)');
    }
  }

  /**
   * Resolve the modelContext that should receive registrations.
   * When Chrome runs with WebMCP enabled (--enable-features=WebMCPTesting /
   * chrome://flags/#enable-webmcp-testing), the REAL runtime lives on
   * navigator.modelContext. document/window are only ever the polyfill, so the
   * native context must always win — otherwise tools are silently swallowed by
   * the polyfill and the agent sees an empty tool list.
   */
  private getNativeContext(): any {
    const nav = (navigator as any).modelContext;
    if (nav && typeof nav.registerTool === 'function') return nav;
    if (document.modelContext && typeof document.modelContext.registerTool === 'function') return document.modelContext;
    const win = (window as any).modelContext;
    if (win && typeof win.registerTool === 'function') return win;
    return null;
  }

  private setupPolyfill() {
    if (typeof window === 'undefined') return;
    // Never shadow a native runtime: with the WebMCP flag enabled the browser
    // provides navigator.modelContext and installs our polyfill would hijack
    // document.modelContext lookups (see getNativeContext).
    if (this.isNativeWebMCPAvailable) return;

    const bridge = this;
    const contextObj = {
      registerTool(tool: any) {
        console.log(`[AlphaX WebMCP API] Registered tool: ${tool.name}`, tool);
      },
      unregisterTool(toolName: string) {
        console.log(`[AlphaX WebMCP API] Unregistered tool: ${toolName}`);
      },
      getRegisteredTools() {
        return Array.from(bridge.registeredTools.values());
      },
    };

    if (!document.modelContext) {
      try {
        Object.defineProperty(document, 'modelContext', {
          value: contextObj,
          writable: true,
          configurable: true,
        });
      } catch (e) {
        (document as any).modelContext = contextObj;
      }
    }

    if (!window.modelContext) {
      try {
        Object.defineProperty(window, 'modelContext', {
          value: contextObj,
          writable: true,
          configurable: true,
        });
      } catch (e) {
        (window as any).modelContext = contextObj;
      }
    }

    if (!(navigator as any).modelContext) {
      try {
        Object.defineProperty(navigator, 'modelContext', {
          value: contextObj,
          writable: true,
          configurable: true,
        });
      } catch (e) {
        (navigator as any).modelContext = contextObj;
      }
    }
  }

  public registerTool(
    tool: WebMCPToolDefinition,
    executor: (params: any) => Promise<ToolExecutionResponse>
  ): RegisteredToolHandle {
    this.registeredTools.set(tool.name, tool);
    this.executors.set(tool.name, executor);

    // Prefer the native runtime (navigator.modelContext when WebMCP flag is on)
    const nativeObj = this.getNativeContext();
    if (nativeObj && typeof nativeObj.registerTool === 'function') {
      try {
        const registered = nativeObj.registerTool({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
          execute: async (params: any) => {
            return await executor(params);
          },
        });
        // Native registerTool is async — surface async validation failures.
        if (registered && typeof registered.then === 'function') {
          registered.catch((err: unknown) => {
            console.warn(`Error registering tool ${tool.name} with native modelContext:`, err);
          });
        }
      } catch (err) {
        console.warn(`Error registering tool ${tool.name} with native modelContext:`, err);
      }
    }

    this.notifyListeners();

    return {
      id: tool.id,
      name: tool.name,
      definition: tool,
      unregister: () => {
        this.unregisterTool(tool.name);
      },
    };
  }

  public unregisterTool(toolName: string) {
    this.registeredTools.delete(toolName);
    this.executors.delete(toolName);
    const nativeObj = this.getNativeContext();
    if (nativeObj && typeof nativeObj.unregisterTool === 'function') {
      try {
        nativeObj.unregisterTool(toolName);
      } catch (err) { }
    }
    this.notifyListeners();
  }

  public unregisterAll() {
    for (const name of this.registeredTools.keys()) {
      this.unregisterTool(name);
    }
    this.registeredTools.clear();
    this.notifyListeners();
  }

  public getRegisteredTools(): WebMCPToolDefinition[] {
    return Array.from(this.registeredTools.values());
  }

  public async invokeRegisteredTool(toolName: string, params: any = {}): Promise<ToolExecutionResponse> {
    const executor = this.executors.get(toolName);
    if (!executor) throw new Error(`WebMCP tool "${toolName}" is not registered on this page.`);
    return executor(params);
  }

  public subscribe(listener: (tools: WebMCPToolDefinition[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.getRegisteredTools());
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    const list = this.getRegisteredTools();
    for (const listener of this.listeners) {
      listener(list);
    }

    if (typeof window !== 'undefined') {
      try {
        const event = new CustomEvent('webmcp:tools-changed', {
          detail: { tools: list, count: list.length },
        });
        window.dispatchEvent(event);
        document.dispatchEvent(event);
      } catch (e) {
        // Fallback for environments where CustomEvent might be restricted
      }
    }
  }
}

export const webmcpBridge = new WebMCPBridge();
