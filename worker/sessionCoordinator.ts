import type { Env } from './env';

type PendingConfirmation = {
  resolve: (approved: boolean) => void;
  expiresAt: number;
};

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

    return new Response('Not found', { status: 404 });
  }

  private broadcast(message: unknown): void {
    const payload = JSON.stringify(message);
    for (const socket of this.sockets) {
      try { socket.send(payload); } catch { this.sockets.delete(socket); }
    }
  }

  private waitForConfirmation(id: string, confirmation: unknown): Promise<boolean> {
    this.broadcast({ type: 'confirmation_required', confirmation });
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        resolve(false);
      }, 60000);
      this.pending.set(id, {
        expiresAt: Date.now() + 60000,
        resolve: (approved) => {
          clearTimeout(timeout);
          this.pending.delete(id);
          resolve(approved);
        },
      });
    });
  }

  private resolveConfirmation(id: string, approved: boolean): void {
    const pending = this.pending.get(id);
    if (pending && pending.expiresAt > Date.now()) pending.resolve(approved);
  }
}
