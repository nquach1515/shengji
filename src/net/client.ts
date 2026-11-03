import { HostController, NetStatus } from './host';
import { Action, ClientMsg, HostMsg, PlayerView } from './protocol';
import { keepAlive, roomUrl } from './relay';
import { rulesFor } from '../game/engine';

/** What the UI talks to — either the in-browser host, or a remote host through the relay. */
export interface GameConnection {
  view(): PlayerView | null;
  status(): { state: NetStatus | 'rejected'; detail: string };
  send(action: Action): void;
  subscribe(fn: () => void): () => void;
  leave(): void;
}

export function getClientId(): string {
  try {
    let id = localStorage.getItem('sj-client-id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('sj-client-id', id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export class LocalConnection implements GameConnection {
  private cached: PlayerView | null = null;
  private listeners = new Set<() => void>();
  constructor(public host: HostController) {
    host.subscribe(() => {
      this.cached = null;
      for (const fn of this.listeners) fn();
    });
  }
  view() {
    return (this.cached ??= this.host.viewFor(this.host.hostClientId));
  }
  status() {
    return { state: this.host.online ? this.host.status : ('online' as NetStatus), detail: this.host.statusDetail };
  }
  send(action: Action) {
    this.host.handle(this.host.hostClientId, action);
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  leave() {
    this.host.destroy();
  }
}

export class RemoteConnection implements GameConnection {
  private current: PlayerView | null = null;
  private state: NetStatus | 'rejected' = 'connecting';
  private detail = 'Connecting…';
  private socket: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private left = false;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public code: string,
    private clientId: string,
    private name: string,
  ) {
    this.connect();
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private setStatus(state: NetStatus | 'rejected', detail: string) {
    this.state = state;
    this.detail = detail;
    this.emit();
  }

  private connect() {
    if (this.left) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(roomUrl(this.code, 'player'));
    } catch {
      this.retry(3000);
      return;
    }
    this.socket = ws;
    const stopPing = keepAlive(ws);
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'hello', clientId: this.clientId, name: this.name } satisfies ClientMsg));
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string' || e.data === 'pong') return;
      const msg = JSON.parse(e.data) as HostMsg;
      if (msg.t === 'view') {
        this.failures = 0;
        // a host still running a version from before 3 decks sends no rules: it's a 2-deck game
        this.current = { ...msg.view, rules: msg.view.rules ?? rulesFor(2) };
        if (this.state !== 'online') this.setStatus('online', '');
        else this.emit();
      } else if (msg.t === 'reject') {
        this.left = true;
        this.setStatus('rejected', msg.reason);
      }
    };
    ws.onclose = (e) => {
      stopPing();
      if (this.left || this.socket !== ws) return;
      this.failures++;
      if (e.code === 4004 || e.code === 4003) {
        this.setStatus('error', this.current ? 'Host disconnected — waiting for them to come back…' : `No table found with code ${this.code}`);
        this.retry(this.current ? 3000 : 5000);
      } else if (e.code === 4001) {
        this.setStatus('connecting', 'Reconnecting to host…');
        this.retry(2000);
      } else {
        this.setStatus(this.failures > 2 ? 'error' : 'connecting', this.failures > 2 ? "Can't reach the game server — retrying…" : 'Reconnecting…');
        this.retry(Math.min(10000, 1000 * 2 ** this.failures));
      }
    };
  }

  private retry(ms: number) {
    if (this.left || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, ms);
  }

  view() {
    return this.current;
  }
  status() {
    return { state: this.state, detail: this.detail };
  }
  send(action: Action) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ t: 'action', action } satisfies ClientMsg));
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  leave() {
    this.left = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.socket?.close();
  }
}
