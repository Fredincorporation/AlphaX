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
  }

  private detectNativeSupport() {
    if (
      typeof window !== 'undefined' &&
      (window.modelContext || (document && document.modelContext) || (navigator && (navigator as any).modelContext))
    ) {
      this.isNativeWebMCPAvailable = true;
      console.log('⚡ [AlphaX WebMCP Bridge] Native WebMCP detected in browser context!');
    } else {
      this.isNativeWebMCPAvailable = false;
      console.log('ℹ️ [AlphaX WebMCP Bridge] Initializing WebMCP Universal Bridge (Polyfill & Native runtime compatibility mode)');
    }
  }

  private setupPolyfill() {
    if (typeof window === 'undefined') return;

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

    // Call document.modelContext if available
    const nativeObj = document.modelContext || (window as any).modelContext || (navigator as any).modelContext;
    if (nativeObj && typeof nativeObj.registerTool === 'function') {
      try {
        nativeObj.registerTool({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
          execute: async (params: any) => {
            return await executor(params);
          },
        });
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
    const nativeObj = document.modelContext || (window as any).modelContext || (navigator as any).modelContext;
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
