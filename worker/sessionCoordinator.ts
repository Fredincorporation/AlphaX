import type { Env } from './env';

export type ApprovalVerdict = 'approved' | 'rejected' | 'timeout';

type PendingConfirmation = {
  resolve: (verdict: ApprovalVerdict) => void;
  expiresAt: number;
};

const CONFIRMATION_TIMEOUT_MS = 60_000;

export class SessionCoordinator {
  private sockets = new Set<WebSocket>();
  private pending = new Map<string, PendingConfirmation>();

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      this.sockets.add(server);
      server.addEventListener('close', () => this.sockets.delete(server));
      server.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.type === 'ping') server.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          if (message.type === 'confirmation_response') this.resolveConfirmation(message.confirmationId, Boolean(message.approved));
        } catch { }
      });
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname.endsWith('/broadcast') && request.method === 'POST') {
      this.broadcast(await request.json());
      return Response.json({ ok: true });
    }

    if (url.pathname.endsWith('/confirm') && request.method === 'POST') {
      const body = await request.json() as { id: string; confirmation: unknown };
      const approved = await this.waitForConfirmation(body.id, body.confirmation);
      return Response.json({ approved });
    }

    // Phase 1 gate: the authoritative server-side approval seam. Blocks the
    // calling request until a human verdict arrives over the WebSocket, and
    // fails CLOSED on timeout (no dashboard answer => rejected).
    if (url.pathname.endsWith('/request-approval') && request.method === 'POST') {
      const body = await request.json() as { id: string; confirmation: unknown };
      const verdict = await this.requestApproval(body.id, body.confirmation);
      return Response.json({ verdict });
    }

    return new Response('Not found', { status: 404 });
  }

  private broadcast(message: unknown): void {
    const payload = JSON.stringify(message);
    for (const socket of this.sockets) {
      try { socket.send(payload); } catch { this.sockets.delete(socket); }
    }
  }

  private waitForConfirmation(id: string, confirmation: unknown): Promise<boolean> {
    return this.requestApproval(id, confirmation).then((verdict) => verdict === 'approved');
  }

  requestApproval(id: string, confirmation: unknown): Promise<ApprovalVerdict> {
    this.broadcast({ type: 'confirmation_required', confirmation });
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        // Tell any surviving dashboard client the request is dead so its
        // modal can close instead of resolving a stale prompt.
        this.broadcast({ type: 'confirmation_expired', confirmationId: id });
        resolve('timeout'); // fail-closed
      }, CONFIRMATION_TIMEOUT_MS);
      this.pending.set(id, {
        expiresAt: Date.now() + CONFIRMATION_TIMEOUT_MS,
        resolve: (verdict) => {
          clearTimeout(timeout);
          this.pending.delete(id);
          resolve(verdict);
        },
      });
    });
  }

  private resolveConfirmation(id: string, approved: boolean): void {
    const pending = this.pending.get(id);
    if (pending && pending.expiresAt > Date.now()) pending.resolve(approved ? 'approved' : 'rejected');
  }
}
