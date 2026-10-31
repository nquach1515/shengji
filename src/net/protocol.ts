import { Card } from '../game/cards';
import { DeclareOption, GameEvent, Phase, RoundResult, Trick, TrumpSuit } from '../game/engine';

export type Action =
  | { type: 'sit'; seat: number }
  | { type: 'swap'; a: number; b: number }
  | { type: 'rename'; name: string }
  | { type: 'addBot'; seat: number }
  | { type: 'removeSeat'; seat: number }
  | { type: 'botify'; seat: number }
  | { type: 'start' }
  | { type: 'declare'; cardIds: string[] }
  | { type: 'pass' }
  | { type: 'bury'; cardIds: string[] }
  | { type: 'play'; cardIds: string[] }
  | { type: 'nextRound' }
  | { type: 'newGame' }
  | { type: 'emote'; emoji: string }
  | { type: 'hint' }
  | { type: 'settings'; settings: Partial<Settings> };

export type Pace = 'relaxed' | 'normal' | 'fast';
export interface Settings {
  /** level both teams start at: 2 classic, 7 shorter, 10 quick */
  startLevel: number;
  pace: Pace;
}

export interface SeatView {
  name: string;
  isBot: boolean;
  isHost: boolean;
  online: boolean;
  cardCount: number;
}

export interface PlayerView {
  roomCode: string;
  online: boolean;
  you: number | null;
  isHost: boolean;
  seats: (SeatView | null)[];
  phase: Phase;
  round: number;
  levels: [number, number];
  dealer: number | null;
  trumpRank: number;
  trumpSuit: TrumpSuit | null;
  hand: Card[];
  deckRemaining: number;
  kittyCount: number;
  /** visible to the dealer after picking up, and to everyone at round end */
  kitty: Card[] | null;
  declaration: { seat: number; cards: Card[]; suit: TrumpSuit; strength: number } | null;
  declareOptions: DeclareOption[];
  passed: boolean[];
  declareRemainingMs: number;
  turn: number;
  trick: Trick | null;
  lastTrick: Trick | null;
  /** every completed trick this round, oldest first */
  tricks: Trick[];
  tricksPlayed: number;
  attackerPoints: number;
  capturedCards: Card[];
  result: RoundResult | null;
  events: GameEvent[];
  emotes: { id: number; seat: number; emoji: string }[];
  /** error for the last action you sent, if any */
  error: { id: number; text: string } | null;
  /** suggested cards after you ask for a hint */
  hint: { id: number; cardIds: string[] } | null;
  settings: Settings;
  /** total points in tricks completed so far this round (for "points blocked") */
  pointsPlayed: number;
  /** effective suits ('S','H','D','C' or 'T' for trump) each seat has shown it's out of this round */
  voids: string[][];
}

export type ClientMsg = { t: 'hello'; clientId: string; name: string } | { t: 'action'; action: Action };
export type HostMsg = { t: 'view'; view: PlayerView } | { t: 'reject'; reason: string };

export const PEER_PREFIX = 'shengji-tractor-v1-';
