import { DataConnection, Peer } from 'peerjs';
import { botBury, botDeclare, botPlay, suggest } from '../game/bot';
import { sortHand } from '../game/rules';
import {
  bury,
  checkPlay,
  collectTrick,
  ctxOf,
  dealOne,
  declare,
  declareOptions,
  finalizeDeclaration,
  GameState,
  newGame,
  nextRound,
  NUM_PLAYERS,
  pass,
  play,
  resetToLobby,
  startRound,
} from '../game/engine';
import { Action, ClientMsg, HostMsg, Pace, PEER_PREFIX, PlayerView, Settings } from './protocol';
import { reliableTimeout } from './timer';
import { redactFor } from '../game/info';
import { iceServers } from './ice';

export interface SeatInfo {
  clientId: string;
  name: string;
  isBot: boolean;
  online: boolean;
}

const BOT_NAMES = ['Mei', 'Jun', 'Lan', 'Bao', 'Ying', 'Kai', 'Lin', 'Tao'];
const PACE: Record<Pace, { deal: number; bot: number; trick: number; think: number }> = {
  // deal = ms per card (100 cards): time enough to watch your hand form and decide whether to declare
  relaxed: { deal: 240, bot: 1.5, trick: 2300, think: 900 },
  normal: { deal: 180, bot: 1, trick: 1750, think: 700 },
  fast: { deal: 110, bot: 0.5, trick: 1450, think: 400 },
};
const SAVE_KEY = 'sj-host-session';

export type NetStatus = 'offline' | 'connecting' | 'online' | 'error';

// Dev only: a running game keeps the engine/rules/bot code it started with, so hot-swapping them would mix
// old rules with new UI. Force a full page reload instead (hosted tables resume from their saved state).
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());

interface Saved {
  code: string;
  state: GameState;
  seats: (SeatInfo | null)[];
  settings?: Settings;
  savedAt: number;
}

export function loadSavedHost(): Saved | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved;
    if (Date.now() - saved.savedAt > 12 * 3600 * 1000) return null;
    return saved;
  } catch {
    return null;
  }
}

export function clearSavedHost() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

export function randomCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
}

/** Runs the authoritative game in the host's browser and serves views to peers. */
export class HostController {
  state: GameState;
  seats: (SeatInfo | null)[];
  settings: Settings = { startLevel: 2, pace: 'normal' };
  status: NetStatus = 'offline';
  statusDetail = '';
  private peer: Peer | null = null;
  private conns = new Map<string, DataConnection>();
  private errors = new Map<string, { id: number; text: string }>();
  private errorSeq = 0;
  private hints = new Map<string, { id: number; cardIds: string[] }>();
  private emotes: { id: number; seat: number; emoji: string }[] = [];
  private emoteSeq = 0;
  private cancelTimer: (() => void) | null = null;
  private listeners = new Set<() => void>();
  private destroyed = false;
  private worker: Worker | null | undefined;
  private workerSeq = 0;
  private workerWaiting = new Map<number, (ids: string[] | null) => void>();
  /** the decision a bot is currently thinking about, so it isn't requested twice */
  private botThinking: string | null = null;
  private hintCache: { key: string; move: Promise<string[] | null> } | null = null;

  constructor(
    public code: string,
    public hostClientId: string,
    hostName: string,
    public online: boolean,
    saved?: Saved,
    settings?: Partial<Settings>,
  ) {
    this.settings = { ...this.settings, ...saved?.settings, ...settings };
    if (saved) {
      this.state = saved.state;
      this.seats = saved.seats.map((s) => (s ? { ...s, online: s.isBot || s.clientId === hostClientId } : null));
    } else {
      this.state = newGame(this.settings.startLevel);
      this.seats = [{ clientId: hostClientId, name: hostName, isBot: false, online: true }, null, null, null];
    }
    if (online) this.openPeer(0);
    this.pump();
  }

  // ---------- networking ----------

  private openPeer(attempt: number) {
    this.status = 'connecting';
    void iceServers().then((servers) => !this.destroyed && this.startPeer(servers, attempt));
  }

  private startPeer(servers: RTCIceServer[], attempt: number) {
    const peer = new Peer(PEER_PREFIX + this.code, { debug: 0, config: { iceServers: servers } });
    this.peer = peer;
    peer.on('open', () => {
      this.status = 'online';
      this.emit();
    });
    peer.on('connection', (conn) => this.attach(conn));
    peer.on('disconnected', () => {
      if (!this.destroyed && !peer.destroyed) setTimeout(() => peer.reconnect(), 1500);
    });
    peer.on('error', (err) => {
      const type = (err as { type?: string }).type;
      if (type === 'unavailable-id' && attempt < 8) {
        // Usually our own previous session (after a refresh) still holds the id for a few seconds.
        this.statusDetail = 'Reclaiming room code…';
        peer.destroy();
        setTimeout(() => !this.destroyed && this.openPeer(attempt + 1), 2500);
      } else if (type === 'network' || type === 'server-error' || type === 'socket-error') {
        this.status = 'error';
        this.statusDetail = 'Lost connection to the matchmaking server — retrying…';
        setTimeout(() => !this.destroyed && !peer.destroyed && peer.reconnect(), 3000);
      } else if (type !== 'peer-unavailable') {
        this.status = 'error';
        this.statusDetail = String(err.message ?? err);
      }
      this.emit();
    });
  }

  private attach(conn: DataConnection) {
    let clientId: string | null = null;
    conn.on('data', (raw) => {
      const msg = raw as ClientMsg;
      if (msg.t === 'hello') {
        clientId = msg.clientId;
        const ok = this.join(msg.clientId, msg.name);
        if (!ok) {
          conn.send({ t: 'reject', reason: 'This table is full' } satisfies HostMsg);
          setTimeout(() => conn.close(), 500);
          return;
        }
        const old = this.conns.get(msg.clientId);
        if (old && old !== conn) old.close();
        this.conns.set(msg.clientId, conn);
        this.changed();
      } else if (msg.t === 'action' && clientId) {
        this.handle(clientId, msg.action);
      }
    });
    conn.on('close', () => {
      if (clientId && this.conns.get(clientId) === conn) {
        this.conns.delete(clientId);
        const seat = this.seatOf(clientId);
        if (seat !== null) this.seats[seat]!.online = false;
        this.changed();
      }
    });
  }

  /** Seats a player (or re-seats a reconnecting one). Returns false if there's no room. */
  private join(clientId: string, name: string): boolean {
    const existing = this.seatOf(clientId);
    if (existing !== null) {
      const s = this.seats[existing]!;
      s.online = true;
      s.isBot = false;
      // keep a name they picked in the lobby; a reconnect re-sends the name they first joined with
      return true;
    }
    const empty = this.seats.findIndex((s) => s === null);
    if (empty >= 0) {
      this.seats[empty] = { clientId, name: name || 'Player', isBot: false, online: true };
      return true;
    }
    return false;
  }

  private seatOf(clientId: string): number | null {
    const i = this.seats.findIndex((s) => s?.clientId === clientId);
    return i >= 0 ? i : null;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private changed() {
    for (const [clientId, conn] of this.conns) {
      if (conn.open) conn.send({ t: 'view', view: this.viewFor(clientId) } satisfies HostMsg);
    }
    this.persist();
    this.emit();
    this.pump();
  }

  private persist() {
    if (!this.online) return;
    try {
      const saved: Saved = { code: this.code, state: this.state, seats: this.seats, settings: this.settings, savedAt: Date.now() };
      localStorage.setItem(SAVE_KEY, JSON.stringify(saved));
    } catch {
      /* storage unavailable — resume just won't work */
    }
  }

  destroy() {
    this.destroyed = true;
    this.worker?.terminate();
    this.cancelTimer?.();
    this.peer?.destroy();
    this.listeners.clear();
  }

  // ---------- actions ----------

  private name = (seat: number) => this.seats[seat]?.name ?? `Seat ${seat + 1}`;

  handle(clientId: string, action: Action) {
    const err = this.apply(clientId, action);
    if (err) this.errors.set(clientId, { id: ++this.errorSeq, text: err });
    this.changed();
  }

  private apply(clientId: string, a: Action): string | null {
    const s = this.state;
    const seat = this.seatOf(clientId);
    const isHost = clientId === this.hostClientId;
    switch (a.type) {
      case 'sit':
        if (s.phase !== 'lobby' || seat === null) return 'Can only change seats in the lobby';
        if (this.seats[a.seat]) return 'Seat taken';
        this.seats[a.seat] = this.seats[seat];
        this.seats[seat] = null;
        return null;
      case 'swap': {
        if (!isHost || s.phase !== 'lobby') return 'Only the host can rearrange seats in the lobby';
        const { a: x, b: y } = a;
        if (![x, y].every((i) => i >= 0 && i < NUM_PLAYERS)) return null;
        [this.seats[x], this.seats[y]] = [this.seats[y], this.seats[x]];
        return null;
      }
      case 'rename': {
        if (seat === null) return 'You are not seated';
        if (s.phase !== 'lobby') return 'Names are locked once the game starts';
        const name = a.name.trim().slice(0, 16);
        if (!name) return 'Name can’t be empty';
        this.seats[seat]!.name = name;
        return null;
      }
      case 'addBot': {
        if (!isHost) return 'Only the host can add bots';
        if (this.seats[a.seat]) return 'Seat taken';
        const used = new Set(this.seats.map((x) => x?.name));
        const name = BOT_NAMES.find((n) => !used.has(n)) ?? 'Bot';
        this.seats[a.seat] = { clientId: `bot-${a.seat}-${Date.now()}`, name, isBot: true, online: true };
        return null;
      }
      case 'removeSeat': {
        if (!isHost || s.phase !== 'lobby') return 'Only the host can do that in the lobby';
        const target = this.seats[a.seat];
        if (!target || target.clientId === this.hostClientId) return null;
        this.conns.get(target.clientId)?.close();
        this.conns.delete(target.clientId);
        this.seats[a.seat] = null;
        return null;
      }
      case 'botify': {
        if (!isHost) return 'Only the host can do that';
        const target = this.seats[a.seat];
        if (!target || target.clientId === this.hostClientId) return null;
        target.isBot = !target.isBot;
        target.online = true;
        return null;
      }
      case 'start':
        if (!isHost) return 'Only the host can start';
        if (this.seats.some((x) => x === null)) return 'Need 4 players — add bots to fill empty seats';
        startRound(s);
        return null;
      case 'nextRound':
        if (!isHost) return 'Waiting for the host';
        if (s.phase !== 'roundEnd') return null;
        nextRound(s);
        return null;
      case 'newGame':
        if (!isHost) return 'Waiting for the host';
        this.state = resetToLobby(s, this.settings.startLevel);
        return null;
      case 'settings':
        if (!isHost) return 'Only the host can change settings';
        this.settings = { ...this.settings, ...a.settings };
        if (s.phase === 'lobby') this.state = resetToLobby(s, this.settings.startLevel);
        return null;
      case 'emote':
        if (seat === null) return null;
        this.emotes = [...this.emotes.slice(-9), { id: ++this.emoteSeq, seat, emoji: a.emoji.slice(0, 4) }];
        return null;
    }
    if (seat === null) return 'You are not seated';
    switch (a.type) {
      case 'hint':
        if (s.phase === 'playing' && s.turn === seat && s.trick?.winner === null) {
          // The hint is exactly what a bot would play in this seat — usually already computed (see prefetchHint).
          const key = this.decisionKey();
          void this.hintFor(seat).then((ids) => {
            if (this.destroyed || this.decisionKey() !== key) return;
            const move = ids && checkPlay(this.state, seat, ids) === null ? ids : suggest(redactFor(this.state, seat), seat);
            this.hints.set(clientId, { id: ++this.errorSeq, cardIds: move });
            this.changed();
          });
        } else if (s.phase === 'burying' && s.dealer === seat) {
          this.hints.set(clientId, { id: ++this.errorSeq, cardIds: botBury(redactFor(s, seat), seat) });
        }
        return null;
      case 'declare':
        return declare(s, seat, a.cardIds);
      case 'pass':
        return pass(s, seat);
      case 'bury':
        return bury(s, seat, a.cardIds);
      case 'play':
        return play(s, seat, a.cardIds, this.name);
    }
    return null;
  }

  // ---------- clock: dealing, timeouts, bots ----------

  private schedule(ms: number, fn: () => void) {
    this.cancelTimer = reliableTimeout(() => {
      this.cancelTimer = null;
      if (this.destroyed) return;
      fn();
      this.changed();
    }, ms);
  }

  private isBot(seat: number) {
    return !!this.seats[seat]?.isBot;
  }

  private pump() {
    this.cancelTimer?.();
    this.cancelTimer = null;
    const s = this.state;
    switch (s.phase) {
      case 'dealing':
        this.schedule(PACE[this.settings.pace].deal, () => {
          const seat = dealOne(s, Date.now());
          if (this.isBot(seat)) {
            const opt = botDeclare(redactFor(s, seat), seat);
            if (opt) declare(s, seat, opt.cardIds);
          }
          if (s.phase === 'declaring') {
            // Last-chance window: each bot (starting from the dealer) may declare once with its full hand, then passes.
            for (let i = 0; i < NUM_PLAYERS; i++) {
              const b = ((s.dealer ?? 0) + i) % NUM_PLAYERS;
              if (!this.isBot(b)) continue;
              const opt = botDeclare(redactFor(s, b), b);
              if (opt) declare(s, b, opt.cardIds);
            }
            for (let i = 0; i < NUM_PLAYERS; i++) if (this.isBot(i)) s.passed[i] = true;
          }
        });
        return;
      case 'declaring': {
        for (let i = 0; i < NUM_PLAYERS; i++) if (this.isBot(i)) s.passed[i] = true;
        const allPassed = s.passed.every(Boolean);
        this.schedule(allPassed ? 300 : Math.max(0, s.declareDeadline - Date.now()), () => {
          if (s.phase === 'declaring') finalizeDeclaration(s);
        });
        return;
      }
      case 'burying':
        if (this.isBot(s.dealer!)) this.schedule(1400 * PACE[this.settings.pace].bot, () => bury(s, s.dealer!, botBury(redactFor(s, s.dealer!), s.dealer!)));
        return;
      case 'playing':
        if (s.trick && s.trick.winner !== null) {
          this.schedule(PACE[this.settings.pace].trick, () => collectTrick(s, this.name));
        } else if (this.isBot(s.turn)) {
          this.thinkAndPlay();
        } else if (s.trick) {
          this.prefetchHint(s.turn);
        }
        return;
    }
  }

  // ---------- bot thinking (search runs in a worker; the move lands after a natural-feeling delay) ----------

  private decisionKey() {
    const s = this.state;
    return `${s.round}:${s.tricksPlayed}:${s.trick?.plays.length ?? -1}:${s.turn}`;
  }

  private thinkAndPlay() {
    const key = this.decisionKey();
    if (this.botThinking === key) return;
    this.botThinking = key;
    const seat = this.state.turn;
    const started = Date.now();
    const minDelay = (650 + Math.random() * 450) * PACE[this.settings.pace].bot;
    void this.botMove(seat).then((ids) => {
      reliableTimeout(() => {
        const s = this.state;
        // Ignore if the game moved on meanwhile (reset, seat handed back to a human, ...).
        if (this.destroyed || this.decisionKey() !== key || !this.isBot(seat) || s.phase !== 'playing') return;
        this.botThinking = null;
        const move = ids && checkPlay(s, seat, ids) === null ? ids : botPlay(redactFor(s, seat), seat);
        play(s, seat, move, this.name);
        this.changed();
      }, Math.max(0, minDelay - (Date.now() - started)));
    });
  }

  /** Start computing the bot move for a human's turn right away, so the Hint button answers instantly. */
  private prefetchHint(seat: number) {
    const key = this.decisionKey();
    if (this.hintCache?.key === key) return;
    this.hintCache = { key, move: this.botMove(seat) };
  }

  private hintFor(seat: number): Promise<string[] | null> {
    this.prefetchHint(seat);
    return this.hintCache!.move;
  }

  private botMove(seat: number): Promise<string[] | null> {
    if (this.worker === undefined) {
      try {
        this.worker = new Worker(new URL('../game/botWorker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent<{ id: number; ids: string[] | null }>) => {
          this.workerWaiting.get(e.data.id)?.(e.data.ids);
          this.workerWaiting.delete(e.data.id);
        };
        this.worker.onerror = () => {
          for (const fn of this.workerWaiting.values()) fn(null);
          this.workerWaiting.clear();
          this.worker = null;
        };
      } catch {
        this.worker = null;
      }
    }
    if (!this.worker) return Promise.resolve(botPlay(redactFor(this.state, seat), seat));
    const id = ++this.workerSeq;
    return new Promise((resolve) => {
      this.workerWaiting.set(id, resolve);
      // bots only ever see a redacted copy: other hands and the face-down kitty are blanked out
      this.worker!.postMessage({ id, state: redactFor(this.state, seat), seat, budgetMs: PACE[this.settings.pace].think });
    });
  }

  // ---------- views ----------

  viewFor(clientId: string): PlayerView {
    const s = this.state;
    const you = this.seatOf(clientId);
    const ctx = ctxOf(s);
    const kittyVisible =
      s.phase === 'roundEnd' || s.phase === 'gameOver' || (you !== null && you === s.dealer && s.phase === 'playing');
    const showKitty = s.phase === 'roundEnd' || s.phase === 'gameOver' ? s.result?.kitty ?? null : s.kitty;
    return {
      roomCode: this.code,
      online: this.online,
      you,
      isHost: clientId === this.hostClientId,
      seats: this.seats.map((x, i) =>
        x
          ? {
              name: x.name,
              isBot: x.isBot,
              isHost: x.clientId === this.hostClientId,
              online: x.online,
              cardCount: s.hands[i]?.length ?? 0,
            }
          : null,
      ),
      phase: s.phase,
      round: s.round,
      levels: s.levels,
      dealer: s.dealer,
      trumpRank: s.trumpRank,
      trumpSuit: s.trumpSuit,
      hand: you === null ? [] : sortHand(s.hands[you], ctx),
      deckRemaining: s.deck.length,
      kittyCount: s.phase === 'burying' ? 0 : 8,
      kitty: kittyVisible ? showKitty : null,
      declaration: s.declaration,
      declareOptions: you === null ? [] : declareOptions(s, you),
      passed: s.passed,
      declareRemainingMs: s.phase === 'declaring' ? Math.max(0, s.declareDeadline - Date.now()) : 0,
      turn: s.turn,
      trick: s.trick,
      lastTrick: s.lastTrick,
      tricks: s.history ?? [],
      tricksPlayed: s.tricksPlayed,
      attackerPoints: s.attackerPoints,
      capturedCards: s.capturedCards,
      result: s.result,
      events: s.events,
      emotes: this.emotes,
      error: this.errors.get(clientId) ?? null,
      hint: this.hints.get(clientId) ?? null,
      settings: this.settings,
      // only completed tricks count, so tallies change when a trick is collected, not as cards hit the table
      pointsPlayed: (s.history ?? []).reduce((t, tr) => t + tr.points, 0),
      voids: s.voids,
    };
  }
}
