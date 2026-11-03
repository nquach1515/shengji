/*
 * Connection to the message relay (relay/ in this repo, a Cloudflare Worker). Everyone — host included — connects
 * to it over a WebSocket, which works through VPNs and work networks that block browser-to-browser WebRTC.
 * The relay only forwards messages; the game still runs in the host's browser.
 */
export const RELAY_URL: string = import.meta.env.VITE_RELAY_URL ?? 'wss://shengji-relay.nquach1515.workers.dev';

const PING_MS = 25000;

export function roomUrl(code: string, role: 'host' | 'player') {
  return `${RELAY_URL}/room/${code}?role=${role}`;
}

/** Keeps a socket alive through proxies that drop idle connections; the relay answers 'ping' itself. */
export function keepAlive(ws: WebSocket): () => void {
  const t = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), PING_MS);
  return () => clearInterval(t);
}

/** The host's end of one player's connection, relayed through the host's own socket. */
export class PlayerLink {
  open = true;
  private onData: ((msg: unknown) => void)[] = [];
  private onClose: (() => void)[] = [];
  constructor(
    public id: string,
    private socket: WebSocket,
  ) {}
  on(ev: 'data', fn: (msg: unknown) => void): void;
  on(ev: 'close', fn: () => void): void;
  on(ev: 'data' | 'close', fn: ((msg: unknown) => void) | (() => void)) {
    if (ev === 'data') this.onData.push(fn as (msg: unknown) => void);
    else this.onClose.push(fn as () => void);
  }
  send(data: unknown) {
    if (this.open && this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ to: this.id, data }));
  }
  close() {
    if (!this.open) return;
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ to: this.id, close: true }));
    this.closed();
  }
  /** @internal */
  deliver(msg: unknown) {
    for (const fn of this.onData) fn(msg);
  }
  /** @internal */
  closed() {
    if (!this.open) return;
    this.open = false;
    for (const fn of this.onClose) fn();
  }
}
