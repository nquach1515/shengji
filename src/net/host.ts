import { DataConnection, Peer } from 'peerjs';
import { botBury, botDeclare, botPlay, suggest } from '../game/bot';
import { sortHand } from '../game/rules';
import {
  bury,
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
import { totalPoints } from '../game/cards';
import { Action, ClientMsg, HostMsg, Pace, PEER_PREFIX, PlayerView, Settings } from './protocol';
import { reliableTimeout } from './timer';

export interface SeatInfo {
  clientId: string;
  name: string;
  isBot: boolean;
  online: boolean;
}

const BOT_NAMES = ['Mei', 'Jun', 'Lan', 'Bao', 'Ying', 'Kai', 'Lin', 'Tao'];
const PACE: Record<Pace, { deal: number; bot: number; trick: number }> = {
  relaxed: { deal: 140, bot: 1.5, trick: 2300 },
  normal: { deal: 105, bot: 1, trick: 1750 },
  fast: { deal: 65, bot: 0.5, trick: 1450 },
};
const SAVE_KEY = 'sj-host-session';

export type NetStatus = 'offline' | 'connecting' | 'online' | 'error';

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
    const peer = new Peer(PEER_PREFIX + this.code, { debug: 0 });
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
      s.name = name || s.name;
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
          this.hints.set(clientId, { id: ++this.errorSeq, cardIds: suggest(s, seat) });
        } else if (s.phase === 'burying' && s.dealer === seat) {
          this.hints.set(clientId, { id: ++this.errorSeq, cardIds: botBury(s, seat) });
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
            const opt = botDeclare(s, seat);
            if (opt) declare(s, seat, opt.cardIds);
          }
          if (s.phase === 'declaring') {
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
        if (this.isBot(s.dealer!)) this.schedule(1400 * PACE[this.settings.pace].bot, () => bury(s, s.dealer!, botBury(s, s.dealer!)));
        return;
      case 'playing':
        if (s.trick && s.trick.winner !== null) {
          this.schedule(PACE[this.settings.pace].trick, () => collectTrick(s, this.name));
        } else if (this.isBot(s.turn)) {
          this.schedule((650 + Math.random() * 450) * PACE[this.settings.pace].bot, () => {
            const ids = botPlay(s, s.turn);
            play(s, s.turn, ids, this.name);
          });
        }
        return;
    }
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
      pointsPlayed: totalPoints(s.played),
      voids: s.voids,
    };
  }
}
