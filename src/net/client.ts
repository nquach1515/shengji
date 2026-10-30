import { DataConnection, Peer } from 'peerjs';
import { HostController, NetStatus } from './host';
import { Action, ClientMsg, HostMsg, PEER_PREFIX, PlayerView } from './protocol';

/** What the UI talks to — either the in-browser host, or a remote host over WebRTC. */
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
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private listeners = new Set<() => void>();
  private left = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public code: string,
    private clientId: string,
    private name: string,
  ) {
    this.start();
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private setStatus(state: NetStatus | 'rejected', detail: string) {
    this.state = state;
    this.detail = detail;
    this.emit();
  }

  private start() {
    const peer = new Peer({ debug: 0 });
    this.peer = peer;
    peer.on('open', () => this.connect());
    peer.on('error', (err) => {
      const type = (err as { type?: string }).type;
      if (type === 'peer-unavailable') {
        this.setStatus('error', this.current ? 'Host disconnected — waiting for them to come back…' : `No table found with code ${this.code}`);
        this.retry(this.current ? 3000 : 5000);
      } else {
        this.setStatus('error', 'Connection problem — retrying…');
        this.retry(3000);
      }
    });
    peer.on('disconnected', () => {
      if (!this.left && !peer.destroyed) setTimeout(() => peer.reconnect(), 1500);
    });
  }

  private connect() {
    if (!this.peer || this.left) return;
    const conn = this.peer.connect(PEER_PREFIX + this.code, { reliable: true });
    this.conn = conn;
    conn.on('open', () => {
      conn.send({ t: 'hello', clientId: this.clientId, name: this.name } satisfies ClientMsg);
      this.setStatus('online', '');
    });
    conn.on('data', (raw) => {
      const msg = raw as HostMsg;
      if (msg.t === 'view') {
        this.current = msg.view;
        this.emit();
      } else if (msg.t === 'reject') {
        this.left = true;
        this.setStatus('rejected', msg.reason);
      }
    });
    conn.on('close', () => {
      if (this.left) return;
      this.setStatus('connecting', 'Reconnecting to host…');
      this.retry(2000);
    });
  }

  private retry(ms: number) {
    if (this.left || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.left) return;
      if (this.peer && !this.peer.destroyed && this.peer.open) this.connect();
      else {
        this.peer?.destroy();
        this.start();
      }
    }, ms);
  }

  view() {
    return this.current;
  }
  status() {
    return { state: this.state, detail: this.detail };
  }
  send(action: Action) {
    if (this.conn?.open) this.conn.send({ t: 'action', action } satisfies ClientMsg);
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  leave() {
    this.left = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.conn?.close();
    this.peer?.destroy();
  }
}
