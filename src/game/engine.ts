import { BIG_JOKER, Card, makeDecks, points, randomInt, shuffle, SMALL_JOKER, Suit, SUIT_GLYPH, SUITS, totalPoints } from './cards';
import { checkThrow, countPairs, countTuples, decompose, effSuit, sortHand, TrumpCtx, trickWinner, validateFollow, validateLead } from './rules';

export const NUM_PLAYERS = 4;
export const DECLARE_WINDOW_MS = 8000;

export type Phase = 'lobby' | 'dealing' | 'declaring' | 'burying' | 'playing' | 'roundEnd' | 'gameOver';
export type TrumpSuit = Suit | 'NT';

/** What changes with the number of decks: kitty size and the score needed to take the deal. */
export interface DeckRules {
  decks: number;
  kitty: number;
  /** points in the whole deck */
  points: number;
  /** attackers need this many to win the round */
  win: number;
  /** every this many points past (or short of) `win` is another level */
  step: number;
}

export function rulesFor(decks: number): DeckRules {
  // 3 decks: 162 cards, 38 each and a 10-card kitty
  return decks === 3 ? { decks: 3, kitty: 10, points: 300, win: 120, step: 40 } : { decks: 2, kitty: 8, points: 200, win: 80, step: 40 };
}

/**
 * Levels a round is worth for the attackers' `points`: attackers reaching `win` gain one per `step` past it;
 * otherwise defenders gain one, plus one for each `step` further short, up to three (two decks: 40-75 one,
 * 5-35 two, 0 three).
 */
export function roundLevels(points: number, r: DeckRules): { attackersWin: boolean; gained: number } {
  if (points >= r.win) return { attackersWin: true, gained: Math.floor((points - r.win) / r.step) };
  return { attackersWin: false, gained: points === 0 ? 3 : Math.min(3, 1 + Math.floor((r.win - 1 - points) / r.step)) };
}

/** States saved before the deck setting existed are 2-deck games. */
export const decksOf = (s: { decks?: number }) => s.decks ?? 2;
export const rulesOf = (s: { decks?: number }) => rulesFor(decksOf(s));

export interface Declaration {
  seat: number;
  cards: Card[];
  suit: TrumpSuit;
  /**
   * 1 single rank card, 2 pair of rank cards, 3 small-joker pair, 4 big-joker pair;
   * with 3 decks also 5 triple of rank cards, 6 small-joker triple, 7 big-joker triple
   */
  strength: number;
}

export interface Play {
  seat: number;
  cards: Card[];
}

export interface Trick {
  leader: number;
  plays: Play[];
  winner: number | null;
  points: number;
}

export interface RoundResult {
  attackerPoints: number;
  kittyPoints: number;
  kittyMultiplier: number;
  kittyBonus: number;
  /** team that gains levels / keeps or takes the deal */
  winnerTeam: number;
  levelsGained: number;
  prevLevels: [number, number];
  newLevels: [number, number];
  nextDealer: number;
  gameWinner: number | null;
  kitty: Card[];
}

export interface GameEvent {
  id: number;
  kind: 'declare' | 'throwFail' | 'trick' | 'info';
  seat?: number;
  text: string;
  /** throwFail: the cards the leader had to take back (now public knowledge) */
  cards?: Card[];
  round?: number;
}

export interface GameState {
  /** 2 or 3 decks (missing in states saved before 3 decks existed: 2) */
  decks?: number;
  phase: Phase;
  round: number;
  levels: [number, number];
  dealer: number | null;
  /** round 1: the first seat to declare trump — they deal, whatever overturns follow */
  firstDeclarer?: number | null;
  trumpRank: number;
  trumpSuit: TrumpSuit | null;
  deck: Card[];
  dealTo: number;
  hands: Card[][];
  kitty: Card[];
  declaration: Declaration | null;
  passed: boolean[];
  declareDeadline: number;
  turn: number;
  trick: Trick | null;
  lastTrick: Trick | null;
  /** every completed trick this round, oldest first */
  history: Trick[];
  tricksPlayed: number;
  attackerPoints: number;
  capturedCards: Card[];
  /** every card played this round (public knowledge, used for card counting) */
  played: Card[];
  /** effective suits each seat has shown to be out of this round */
  voids: string[][];
  /**
   * Per seat, effective suit → the most identical cards of that suit the seat can still hold, shown by failing to
   * match a pair (2 decks: 1, no pairs left) or a triple (3 decks: 2, no triples left). Absent = no limit shown.
   */
  maxCopies?: Record<string, number>[];
  result: RoundResult | null;
  events: GameEvent[];
  eventSeq: number;
}

export type Result = string | null;

export const teamOf = (seat: number) => seat % 2;
export const nextSeat = (seat: number) => (seat + 1) % NUM_PLAYERS;

export function ctxOf(s: GameState): TrumpCtx {
  return { suit: s.trumpSuit, rank: s.trumpRank };
}

export function newGame(startLevel = 2, decks = 2): GameState {
  return {
    decks,
    phase: 'lobby',
    round: 0,
    levels: [startLevel, startLevel],
    dealer: null,
    firstDeclarer: null,
    trumpRank: startLevel,
    trumpSuit: null,
    deck: [],
    dealTo: 0,
    hands: [[], [], [], []],
    kitty: [],
    declaration: null,
    passed: [false, false, false, false],
    declareDeadline: 0,
    turn: 0,
    trick: null,
    lastTrick: null,
    history: [],
    tricksPlayed: 0,
    attackerPoints: 0,
    capturedCards: [],
    played: [],
    voids: [[], [], [], []],
    maxCopies: [{}, {}, {}, {}],
    result: null,
    events: [],
    eventSeq: 0,
  };
}

function pushEvent(s: GameState, kind: GameEvent['kind'], text: string, seat?: number, cards?: Card[]) {
  s.events = [...s.events.slice(-19), { id: ++s.eventSeq, kind, text, seat, cards, round: s.round }];
}

export function startRound(s: GameState): void {
  const deck = shuffle(makeDecks(decksOf(s)));
  s.round += 1;
  s.kitty = deck.splice(0, rulesOf(s).kitty);
  s.deck = deck;
  s.hands = [[], [], [], []];
  s.trumpRank = s.dealer === null ? s.levels[0] : s.levels[teamOf(s.dealer)];
  s.trumpSuit = null;
  s.dealTo = s.dealer ?? 0;
  s.declaration = null;
  s.firstDeclarer = null;
  s.passed = [false, false, false, false];
  s.trick = null;
  s.lastTrick = null;
  s.history = [];
  s.tricksPlayed = 0;
  s.attackerPoints = 0;
  s.capturedCards = [];
  s.played = [];
  s.voids = [[], [], [], []];
  s.maxCopies = [{}, {}, {}, {}];
  s.result = null;
  s.phase = 'dealing';
}

/** Deals a single card. Returns the seat that received it. */
export function dealOne(s: GameState, now: number): number {
  const seat = s.dealTo;
  const card = s.deck.pop()!;
  s.hands[seat] = [...s.hands[seat], card];
  s.dealTo = nextSeat(seat);
  if (s.deck.length === 0) {
    s.phase = 'declaring';
    s.declareDeadline = now + DECLARE_WINDOW_MS;
  }
  return seat;
}

export interface DeclareOption {
  cardIds: string[];
  suit: TrumpSuit;
  strength: number;
}

export function declareOptions(s: GameState, seat: number): DeclareOption[] {
  if (s.phase !== 'dealing' && s.phase !== 'declaring') return [];
  if (s.passed[seat]) return [];
  const hand = s.hands[seat];
  const opts: DeclareOption[] = [];
  for (const suit of SUITS) {
    const rankCards = hand.filter((c) => c.suit === suit && c.rank === s.trumpRank);
    if (rankCards.length >= 1) opts.push({ cardIds: [rankCards[0].id], suit, strength: 1 });
    if (rankCards.length >= 2) opts.push({ cardIds: rankCards.slice(0, 2).map((c) => c.id), suit, strength: 2 });
    if (rankCards.length >= 3) opts.push({ cardIds: rankCards.slice(0, 3).map((c) => c.id), suit, strength: 5 });
  }
  for (const [rank, strength] of [
    [SMALL_JOKER, 3],
    [BIG_JOKER, 4],
  ] as const) {
    const js = hand.filter((c) => c.suit === 'J' && c.rank === rank);
    // with 3 decks only three of the same joker declare no trump
    if (js.length >= 2 && decksOf(s) !== 3) opts.push({ cardIds: js.slice(0, 2).map((c) => c.id), suit: 'NT', strength });
    // any triple outranks any pair
    if (js.length >= 3) opts.push({ cardIds: js.slice(0, 3).map((c) => c.id), suit: 'NT', strength: strength + 3 });
  }
  const cur = s.declaration;
  if (!cur) return opts;
  // Anything stronger overrides, including your own declaration: a single with a pair of any suit (yours too), a
  // pair with a triple with 3 decks, and so on up to jokers.
  return opts.filter((o) => o.strength > cur.strength);
}

export function declare(s: GameState, seat: number, cardIds: string[]): Result {
  const opt = declareOptions(s, seat).find(
    (o) => o.cardIds.length === cardIds.length && o.cardIds.every((id) => cardIds.includes(id)),
  );
  if (!opt) return "You can't declare that";
  const cards = s.hands[seat].filter((c) => opt.cardIds.includes(c.id));
  s.declaration = { seat, cards, suit: opt.suit, strength: opt.strength };
  s.firstDeclarer ??= seat;
  s.trumpSuit = opt.suit;
  s.passed = s.passed.map(() => false);
  if (s.phase === 'declaring') s.declareDeadline = Math.max(s.declareDeadline, Date.now() + 3000);
  return null;
}

export function pass(s: GameState, seat: number): Result {
  if (s.phase !== 'declaring') return 'Nothing to pass';
  s.passed[seat] = true;
  return null;
}

export function finalizeDeclaration(s: GameState): void {
  if (s.declaration) {
    s.trumpSuit = s.declaration.suit;
    // first round: the first to declare deals; an overturn only changes the trump suit
    if (s.dealer === null) s.dealer = s.firstDeclarer ?? s.declaration.seat;
  } else {
    // Nobody declared: flip the kitty — the first suited card picks trump.
    const flip = s.kitty.find((c) => c.suit !== 'J');
    s.trumpSuit = flip ? (flip.suit as Suit) : 'NT';
    if (s.dealer === null) s.dealer = randomInt(NUM_PLAYERS); // first round, nobody declared: random dealer
    pushEvent(
      s,
      'info',
      flip ? `No one declared — kitty flip makes ${SUIT_GLYPH[flip.suit]} trump` : 'No one declared — no-trump round',
    );
  }
  s.trumpRank = s.levels[teamOf(s.dealer)];
  s.hands[s.dealer] = [...s.hands[s.dealer], ...s.kitty];
  s.kitty = [];
  s.phase = 'burying';
}

export function bury(s: GameState, seat: number, cardIds: string[]): Result {
  if (s.phase !== 'burying' || seat !== s.dealer) return 'Not your turn to bury';
  const ids = new Set(cardIds);
  const n = rulesOf(s).kitty;
  if (ids.size !== n) return `Select exactly ${n} cards to bury`;
  const hand = s.hands[seat];
  if (hand.filter((c) => ids.has(c.id)).length !== n) return 'Invalid cards';
  s.kitty = hand.filter((c) => ids.has(c.id));
  s.hands[seat] = hand.filter((c) => !ids.has(c.id));
  s.phase = 'playing';
  s.turn = seat;
  s.trick = { leader: seat, plays: [], winner: null, points: 0 };
  return null;
}

/** Validates a play without applying it. */
export function checkPlay(s: GameState, seat: number, cardIds: string[]): Result {
  if (s.phase !== 'playing' || !s.trick || s.trick.winner !== null) return 'Not time to play';
  if (s.turn !== seat) return 'Not your turn';
  const hand = s.hands[seat];
  const ids = new Set(cardIds);
  const cards = hand.filter((c) => ids.has(c.id));
  if (cards.length !== ids.size || cards.length === 0) return 'Select cards to play';
  const ctx = ctxOf(s);
  if (s.trick.plays.length === 0) return validateLead(cards, ctx);
  return validateFollow(cards, hand, s.trick.plays[0].cards, ctx);
}

export function play(s: GameState, seat: number, cardIds: string[], seatName: (seat: number) => string): Result {
  const err = checkPlay(s, seat, cardIds);
  if (err) return err;
  const trick = s.trick!;
  const ctx = ctxOf(s);
  const hand = s.hands[seat];
  let cards = hand.filter((c) => cardIds.includes(c.id));
  if (trick.plays.length === 0) {
    const others = s.hands.filter((_, i) => i !== seat);
    const forced = checkThrow(cards, others, ctx);
    if (forced) {
      // A throw is only allowed if nobody can beat any part of it; otherwise the leader must play the
      // beatable part, and the cards they take back are revealed to everyone.
      const keep = new Set(forced.cards.map((c) => c.id));
      const returned = cards.filter((c) => !keep.has(c.id));
      cards = forced.cards;
      pushEvent(s, 'throwFail', `${seatName(seat)}'s throw was blocked — someone can beat part of it`, seat, returned);
    }
  }
  if (trick.plays.length > 0) {
    const leadSuit = effSuit(trick.plays[0].cards[0], ctx);
    const followed = cards.filter((c) => effSuit(c, ctx) === leadSuit).length;
    if (followed < cards.length && !s.voids[seat].includes(leadSuit)) s.voids[seat] = [...s.voids[seat], leadSuit];
    else if (followed === cards.length) {
      // Anyone who could match a pair (or triple) in the lead had to, so playing fewer shows there are none left.
      const lead = decompose(trick.plays[0].cards, ctx);
      const units = (width: number) => lead.reduce((t, c) => t + (c.width === width ? c.len : 0), 0);
      const limit = (n: number) => {
        const m = (s.maxCopies ??= [{}, {}, {}, {}]);
        m[seat] = { ...m[seat], [leadSuit]: Math.min(m[seat][leadSuit] ?? n, n) };
      };
      // 2 decks only: with 3 decks a triple needn't answer a pair, and breaking one can leave a pair behind
      if (decksOf(s) === 2 && countPairs(cards) < units(2)) limit(1);
      if (decksOf(s) === 3 && countTuples(cards, 3) < units(3)) limit(2);
    }
  }
  cards = sortHand(cards, ctx); // show every play in rank order, least to greatest
  s.played = [...s.played, ...cards];
  const played = new Set(cards.map((c) => c.id));
  s.hands[seat] = hand.filter((c) => !played.has(c.id));
  trick.plays = [...trick.plays, { seat, cards }];
  trick.points += totalPoints(cards);
  if (trick.plays.length === NUM_PLAYERS) {
    trick.winner = trickWinner(trick.plays, ctx);
    s.turn = trick.winner;
  } else {
    s.turn = nextSeat(seat);
  }
  return null;
}

/** Collects a finished trick and either starts the next one or ends the round. */
export function collectTrick(s: GameState, seatName: (seat: number) => string): void {
  const trick = s.trick!;
  const winner = trick.winner!;
  const dealer = s.dealer!;
  if (teamOf(winner) !== teamOf(dealer) && trick.points > 0) {
    s.attackerPoints += trick.points;
    s.capturedCards = [...s.capturedCards, ...trick.plays.flatMap((p) => p.cards.filter((c) => points(c) > 0))];
    pushEvent(s, 'trick', `${seatName(winner)} captures ${trick.points} points`, winner);
  }
  s.tricksPlayed += 1;
  s.lastTrick = trick;
  s.history = [...(s.history ?? []), trick];
  if (s.hands.every((h) => h.length === 0)) {
    endRound(s, trick);
  } else {
    s.trick = { leader: winner, plays: [], winner: null, points: 0 };
    s.turn = winner;
  }
}

function endRound(s: GameState, last: Trick): void {
  const dealer = s.dealer!;
  const defenders = teamOf(dealer);
  const attackers = 1 - defenders;
  const kittyPoints = totalPoints(s.kitty);
  let kittyMultiplier = 0;
  if (teamOf(last.winner!) === attackers) {
    // Kitty points are doubled, whatever the last trick's lead was.
    kittyMultiplier = 2;
  }
  const kittyBonus = kittyPoints * kittyMultiplier;
  s.attackerPoints += kittyBonus;
  const p = s.attackerPoints;
  const { attackersWin, gained } = roundLevels(p, rulesOf(s));
  const prevLevels: [number, number] = [...s.levels];
  const levels: [number, number] = [...s.levels];
  let winnerTeam: number;
  let nextDealer: number;
  let gameWinner: number | null = null;
  if (!attackersWin) {
    winnerTeam = defenders;
    if (levels[defenders] >= 14) gameWinner = defenders;
    levels[defenders] = Math.min(14, levels[defenders] + gained);
    nextDealer = (dealer + 2) % NUM_PLAYERS;
  } else {
    winnerTeam = attackers;
    levels[attackers] = Math.min(14, levels[attackers] + gained);
    nextDealer = nextSeat(dealer);
  }
  s.levels = levels;
  s.result = {
    attackerPoints: p,
    kittyPoints,
    kittyMultiplier,
    kittyBonus,
    winnerTeam,
    levelsGained: gained,
    prevLevels,
    newLevels: levels,
    nextDealer,
    gameWinner,
    kitty: s.kitty,
  };
  s.trick = null;
  s.phase = gameWinner !== null ? 'gameOver' : 'roundEnd';
}

export function nextRound(s: GameState): void {
  if (!s.result) return;
  s.dealer = s.result.nextDealer;
  startRound(s);
}

export function resetToLobby(s: GameState, startLevel = 2, decks = 2): GameState {
  return { ...newGame(startLevel, decks), eventSeq: s.eventSeq };
}
