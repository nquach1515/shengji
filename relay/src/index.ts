/*
 * Message relay for online tables. The game itself still runs in the host's browser; this only forwards messages
 * between the host and the players over WebSockets (wss on port 443, which VPNs and work networks let through,
 * unlike browser-to-browser WebRTC).
 *
 * One Durable Object per room code holds that room's sockets.
 *   host   → wss://…/room/CODE?role=host     sends {to, data} or {to, close: true}; receives {k: 'open'|'msg'|'close', id, data?}
 *   player → wss://…/room/CODE?role=player   sends and receives the game's own messages, untouched
 * A player who connects while no host is in the room is closed with code 4004.
 */
import { DurableObject } from 'cloudflare:workers';

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/room\/([A-Z]{4})$/);
    if (!m) return new Response('shengji relay', { status: 200 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  },
};

const MAX_MSG = 256 * 1024;

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // keepalive pings are answered without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req: Request): Promise<Response> {
    const role = new URL(req.url).searchParams.get('role');
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (role === 'host') {
      // a refreshed host replaces its old connection
      for (const old of this.ctx.getWebSockets('host')) old.close(4000, 'replaced');
      this.ctx.acceptWebSocket(server, ['host']);
    } else {
      const host = this.host();
      if (!host) {
        this.ctx.acceptWebSocket(server, ['dead']);
        server.close(4004, 'no host');
        return new Response(null, { status: 101, webSocket: client });
      }
      const id = crypto.randomUUID();
      this.ctx.acceptWebSocket(server, ['player', `p:${id}`]);
      server.serializeAttachment({ id });
      host.send(JSON.stringify({ k: 'open', id }));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private host(): WebSocket | null {
    return this.ctx.getWebSockets('host')[0] ?? null;
  }

  private isHost(ws: WebSocket) {
    return this.ctx.getTags(ws).includes('host');
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > MAX_MSG) return;
    if (this.isHost(ws)) {
      let msg: { to?: string; data?: unknown; close?: boolean };
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      const target = msg.to ? this.ctx.getWebSockets(`p:${msg.to}`)[0] : undefined;
      if (!target) return;
      if (msg.close) target.close(4001, 'closed by host');
      else target.send(JSON.stringify(msg.data));
    } else {
      const { id } = ws.deserializeAttachment() as { id: string };
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }
      this.host()?.send(JSON.stringify({ k: 'msg', id, data }));
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.gone(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.gone(ws);
  }

  private gone(ws: WebSocket) {
    const tags = this.ctx.getTags(ws);
    if (tags.includes('host')) {
      // only if no newer host connection took over
      if (this.ctx.getWebSockets('host').some((h) => h !== ws)) return;
      for (const p of this.ctx.getWebSockets('player')) p.close(4003, 'host left');
    } else if (tags.includes('player')) {
      const { id } = ws.deserializeAttachment() as { id: string };
      this.host()?.send(JSON.stringify({ k: 'close', id }));
    }
  }
}
