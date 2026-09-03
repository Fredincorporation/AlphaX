import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { browserManager } from './browserManager.js';
import { llmToolGenerator } from './llmToolGenerator.js';
import { actionExecutor } from './actionExecutor.js';
import { persistenceStore } from './db.js';
import { PREBUILT_RECIPES, SAMPLE_TARGETS } from './prebuiltRecipes.js';
import { WebMCPToolDefinition, ToolExecutionRequest, ConfirmationRequest } from '../shared/types.js';

dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptimeSeconds: Math.round(process.uptime()), ...browserManager.getResourceStats() });
});

// Populate prebuilt recipes if not already stored
for (const [domain, tools] of Object.entries(PREBUILT_RECIPES)) {
  const existing = persistenceStore.getToolsByDomain(domain);
  if (existing.length === 0) {
    persistenceStore.saveTools(tools);
  }
}

// Active WebSocket connections mapped by sessionId
const sessionSockets = new Map<string, Set<WebSocket>>();
const pendingConfirmations = new Map<string, { resolve: (val: boolean) => void; req: ConfirmationRequest }>();

function broadcastToSession(sessionId: string, message: any) {
  const sockets = sessionSockets.get(sessionId);
  if (sockets) {
    const payload = JSON.stringify(message);
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }
}

// WebSocket protocol
wss.on('connection', (ws, req) => {
  const urlParams = new URLSearchParams(req.url?.split('?')[1] || '');
  const sessionId = urlParams.get('sessionId') || 'default';

  if (!sessionSockets.has(sessionId)) {
    sessionSockets.set(sessionId, new Set());
  }
  sessionSockets.get(sessionId)!.add(ws);

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'confirmation_response') {
        const { confirmationId, approved } = msg;
        const pending = pendingConfirmations.get(confirmationId);
        if (pending) {
          pending.resolve(!!approved);
          pendingConfirmations.delete(confirmationId);
        }
      } else if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      }
    } catch (e) {
      console.error('Error handling WS message:', e);
    }
  });

  ws.on('close', () => {
    const sockets = sessionSockets.get(sessionId);
    if (sockets) {
      sockets.delete(ws);
      if (sockets.size === 0) {
        sessionSockets.delete(sessionId);
      }
    }
  });

  ws.send(JSON.stringify({ type: 'connected', sessionId }));
});

// REST API Routes

// 1. Get Samples
app.get('/api/samples', (req, res) => {
  const samplesByDomain = new Map(SAMPLE_TARGETS.map(sample => [sample.domain, sample]));
  for (const tool of persistenceStore.getAllTools()) {
    if (!samplesByDomain.has(tool.domain)) {
      samplesByDomain.set(tool.domain, {
        name: tool.domain,
        url: `https://${tool.domain}`,
        description: `Registered WebMCP tools for ${tool.domain}`,
        domain: tool.domain,
      });
    }
  }
  res.json({ samples: Array.from(samplesByDomain.values()) });
});

// 2. Set API Key
app.post('/api/config/llm-key', (req, res) => {
  const { apiKey } = req.body;
  if (apiKey) {
    llmToolGenerator.setApiKey(apiKey);
    res.json({ success: true, message: 'LLM API key updated successfully.' });
  } else {
    res.status(400).json({ error: 'Missing apiKey' });
  }
});

// 3. Analyze Page & Generate WebMCP Tools
app.post('/api/analyze', async (req, res) => {
  const { url, sessionId = 'default', forceRegenerate = false } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Missing required field "url"' });
  }

  try {
    broadcastToSession(sessionId, { type: 'status_update', status: 'navigating', message: `Navigating to ${url}...` });

    // Navigate and extract
    const navResult = await browserManager.navigateTo(sessionId, url);

    broadcastToSession(sessionId, { type: 'status_update', status: 'analyzing', message: 'Analyzing DOM, forms, and accessibility tree...' });
    const analysis = await browserManager.analyzePage(sessionId);

    // Check persistence store for existing domain tools
    let domain = analysis.domain;
    let savedApprovedTools = persistenceStore.getToolsByDomain(domain)
      .filter(tool => tool.status === 'approved');

    // Generate tool proposals
    broadcastToSession(sessionId, { type: 'status_update', status: 'generating', message: 'Synthesizing WebMCP tool definitions...' });
    let proposedTools = await llmToolGenerator.generateTools(analysis);

    broadcastToSession(sessionId, {
      type: 'screenshot_update',
      screenshotBase64: analysis.screenshotBase64,
      url: analysis.url,
      title: analysis.title
    });

    res.json({
      success: true,
      analysis,
      proposedTools,
      approvedTools: savedApprovedTools,
      domain,
    });
  } catch (error: any) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: error.message || 'Failed to analyze page' });
  }
});

// 4. Save / Approve Tools
app.post('/api/tools/approve', async (req, res) => {
  const { tools, domain } = req.body;
  if (!Array.isArray(tools) || !domain) {
    return res.status(400).json({ error: 'Missing tools array or domain' });
  }

  try {
    const updatedTools: WebMCPToolDefinition[] = tools.map((t: WebMCPToolDefinition) => ({
      ...t,
      status: 'approved' as const,
      updatedAt: new Date().toISOString(),
    }));

    await persistenceStore.saveTools(updatedTools);
    res.json({ success: true, count: updatedTools.length, tools: updatedTools });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Revoke Tools for Domain
app.delete('/api/tools/:domain', async (req, res) => {
  const { domain } = req.params;
  try {
    await persistenceStore.deleteToolsForDomain(domain);
    res.json({ success: true, message: `Revoked all tools for ${domain}` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Get Tools for Domain or All Approved
app.get('/api/tools', (req, res) => {
  const domain = req.query.domain as string | undefined;
  try {
    if (domain) {
      const tools = persistenceStore.getToolsByDomain(domain);
      return res.json({ tools });
    }
    const tools = persistenceStore.getAllTools();
    res.json({ tools });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Execute WebMCP Tool
app.post('/api/tools/execute', async (req, res) => {
  const { sessionId = 'default', tool, request, supervisionMode = 'supervised' } = req.body;

  if (!tool || !request) {
    return res.status(400).json({ error: 'Missing tool or request object' });
  }

  try {
    const execResponse = await actionExecutor.executeTool(
      sessionId,
      tool,
      request,
      {
        supervisionMode,
        onLog: (log) => {
          broadcastToSession(sessionId, { type: 'execution_log', log });
        },
        onConfirmationRequired: (confirmReq) => {
          return new Promise<boolean>((resolve) => {
            pendingConfirmations.set(confirmReq.id, { resolve, req: confirmReq });
            broadcastToSession(sessionId, { type: 'confirmation_required', confirmation: confirmReq });

            // Auto-timeout after 60s
            setTimeout(() => {
              if (pendingConfirmations.has(confirmReq.id)) {
                pendingConfirmations.delete(confirmReq.id);
                resolve(false);
              }
            }, 60000);
          });
        },
      }
    );

    // Save to persistence store audit log
    await persistenceStore.saveExecutionResponse(sessionId, execResponse, request.parameters, tool.domain, request.origin || 'playground');

    // Broadcast new screenshot if available
    if (execResponse.finalScreenshotBase64) {
      broadcastToSession(sessionId, {
        type: 'screenshot_update',
        screenshotBase64: execResponse.finalScreenshotBase64
      });
    }

    res.json(execResponse);
  } catch (error: any) {
    console.error('Execution error:', error);
    res.status(500).json({ error: error.message || 'Execution error' });
  }
});

// 8. Get Execution Audit Logs
app.get('/api/history', (req, res) => {
  const domain = req.query.domain as string | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
  try {
    const logs = persistenceStore.getExecutionLogs(domain, limit);
    res.json({ logs });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 9. Session Browser Control (screenshot, reload, back)
app.post('/api/session/screenshot', async (req, res) => {
  const { sessionId = 'default' } = req.body;
  try {
    const screenshot = await browserManager.captureScreenshot(sessionId);
    res.json({ screenshotBase64: screenshot });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`⚡ AlphaX - Universal Agent Mediation Layer Server ⚡`);
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(`WebSocket ready at ws://localhost:${PORT}/ws`);
  console.log(`WebMCP Bridge Active.`);
  console.log(`======================================================\n`);
});
