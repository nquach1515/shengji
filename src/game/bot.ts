import { Card, cardKey, makeDecks, points, totalPoints } from './cards';
import { ctxOf, declareOptions, DeclareOption, decksOf, GameState, NUM_PLAYERS, rulesOf, teamOf } from './engine';
import {
  cardValue,
  Component,
  countTuples,
  decompose,
  effSuit,
  followDuties,
  EffSuit,
  isTrump,
  matchShape,
  TrumpCtx,
  trickWinner,
  tuplesOf,
  validateFollow,
} from './rules';

/*
 * Bots play fair: they only use their own hand, the cards played so far, the voids players have revealed,
 * and (for the dealer) the cards they buried. They never peek at other hands.
 */

const byValue = (ctx: TrumpCtx) => (a: Card, b: Card) => cardValue(a, ctx) - cardValue(b, ctx);

/** How "expensive" a card is to give up (ignoring points, which are weighed separately). */
function strength(c: Card, ctx: TrumpCtx): number {
  return (isTrump(c, ctx) ? 20 : 0) + cardValue(c, ctx);
}

function discardCost(c: Card, ctx: TrumpCtx): number {
  return strength(c, ctx) * 3 + points(c) * 6;
}

/**
 * Penalty for splitting pairs: playing one card of an identical pair you hold throws away a combination that can
 * win pair leads and form tractors, which is worth much more than the card's rank suggests.
 */
function pairBreakCost(play: Card[], hand: Card[], ctx: TrumpCtx): number {
  const inHand = new Map<string, number>();
  for (const c of hand) inHand.set(cardKey(c), (inHand.get(cardKey(c)) ?? 0) + 1);
  const inPlay = new Map<string, Card>();
  const playedCount = new Map<string, number>();
  for (const c of play) {
    inPlay.set(cardKey(c), c);
    playedCount.set(cardKey(c), (playedCount.get(cardKey(c)) ?? 0) + 1);
  }
  let cost = 0;
  for (const [key, c] of inPlay) {
    // splitting a pair, or a triple (by playing one or two of it)
    if ((inHand.get(key) ?? 0) >= 2 && playedCount.get(key)! < inHand.get(key)!) cost += 14 + cardValue(c, ctx) + (isTrump(c, ctx) ? 10 : 0);
  }
  return cost;
}

/** All tractors of exactly `len` pairs (or triples, with width 3) within `cards`, lowest first. */
function tractorsOf(cards: Card[], len: number, ctx: TrumpCtx, width = 2): Card[][] {
  const pairs = tuplesOf(cards, width).sort((a, b) => cardValue(a[0], ctx) - cardValue(b[0], ctx));
  const out: Card[][] = [];
  for (let i = 0; i < pairs.length; i++) {
    const chain = [pairs[i]];
    for (const p of pairs.slice(i + 1)) {
      if (chain.length === len) break;
      if (cardValue(p[0], ctx) === cardValue(chain[chain.length - 1][0], ctx) + 1) chain.push(p);
    }
    if (chain.length === len) out.push(chain.flat());
  }
  return out;
}

function fill(chosen: Card[], pool: Card[], n: number, ctx: TrumpCtx, preferPoints: boolean): Card[] {
  const ids = new Set(chosen.map((c) => c.id));
  const left = pool.filter((c) => !ids.has(c.id));
  const count = new Map<string, number>();
  for (const c of left) count.set(cardKey(c), (count.get(cardKey(c)) ?? 0) + 1);
  const paired = (c: Card) => (count.get(cardKey(c)) ?? 0) >= 2;
  const rest = left.sort((a, b) =>
    preferPoints
      ? points(b) - points(a) || Number(paired(a)) - Number(paired(b)) || strength(a, ctx) - strength(b, ctx)
      : discardCost(a, ctx) + (paired(a) ? 40 : 0) - (discardCost(b, ctx) + (paired(b) ? 40 : 0)),
  );
  return [...chosen, ...rest.slice(0, n - chosen.length)];
}

/** A legal follow that respects suit and pair/tractor obligations, using the cheapest cards. */
export function legalFollow(hand: Card[], lead: Card[], ctx: TrumpCtx, preferPoints = false): Card[] {
  const n = lead.length;
  const suit = effSuit(lead[0], ctx);
  const suitCards = hand.filter((c) => effSuit(c, ctx) === suit);
  if (suitCards.length <= n) return fill(suitCards, hand, n, ctx, preferPoints);
  const duty = followDuties(lead, suitCards, ctx);
  const cheap = (a: Card[], b: Card[]) =>
    preferPoints ? points(b[0]) - points(a[0]) : discardCost(a[0], ctx) - discardCost(b[0], ctx);
  // Builds up the required structure in the given order. Picks may overlap what's already chosen (a triple can
  // complete a pair the tractor took from it), so the order matters only in rare throws; try another if one fails.
  const build = (order: ('tractor' | 'triples' | 'pairs')[]): Card[] | null => {
    let chosen: Card[] = [];
    const add = (cards: Card[]) => {
      const ids = new Set(chosen.map((c) => c.id));
      chosen = [...chosen, ...cards.filter((c) => !ids.has(c.id))];
    };
    const newCards = (t: Card[]) => t.filter((c) => !chosen.some((x) => x.id === c.id)).length;
    for (const step of order) {
      if (step === 'tractor') {
        if (duty.tractorLen) add(tractorsOf(suitCards, duty.tractorLen, ctx, duty.tractorWidth)[0] ?? []);
        continue;
      }
      const width = step === 'triples' ? 3 : 2;
      const need = (width === 3 ? duty.triples : duty.pairs) - countTuples(chosen, width);
      if (need <= 0) continue;
      const count = new Map<string, number>();
      for (const c of suitCards) count.set(cardKey(c), (count.get(cardKey(c)) ?? 0) + 1);
      // fewest new cards first (completing what's chosen), then real pairs before split triples, then cheapest
      const split = (t: Card[]) => (count.get(cardKey(t[0]))! > width ? 1 : 0);
      const options = tuplesOf(suitCards, width)
        .filter((t) => newCards(t) > 0)
        .sort((a, b) => newCards(a) - newCards(b) || split(a) - split(b) || cheap(a, b));
      for (const t of options.slice(0, need)) add(t);
    }
    if (chosen.length > n) return null;
    const play = fill(chosen, suitCards, n, ctx, preferPoints);
    return validateFollow(play, hand, lead, ctx) === null ? play : null;
  };
  return (
    build(['tractor', 'triples', 'pairs']) ??
    build(['triples', 'tractor', 'pairs']) ??
    build(['triples', 'pairs', 'tractor']) ??
    fill([], suitCards, n, ctx, preferPoints)
  );
}

// ---------------------------------------------------------------------------------------------
// Knowledge: what this seat can legitimately know.

interface Know {
  ctx: TrumpCtx;
  seat: number;
  /** cards whose location is unknown to this seat (in other hands, or the kitty if we're not dealer) */
  unseen: Card[];
  voids: Set<string>[];
}

function knowledge(s: GameState, seat: number): Know {
  const seen = new Set<string>();
  for (const c of s.hands[seat]) seen.add(c.id);
  for (const c of s.played) seen.add(c.id);
  if (seat === s.dealer) for (const c of s.kitty) seen.add(c.id);
  return {
    ctx: ctxOf(s),
    seat,
    unseen: makeDecks(decksOf(s)).filter((c) => !seen.has(c.id)),
    voids: s.voids.map((v) => new Set(v)),
  };
}

function unseenIn(k: Know, suit: EffSuit): Card[] {
  return k.unseen.filter((c) => effSuit(c, k.ctx) === suit);
}

/** No unseen card in the suit can beat this single. */
function bossSingle(c: Card, k: Know): boolean {
  const v = cardValue(c, k.ctx);
  return !unseenIn(k, effSuit(c, k.ctx)).some((u) => cardValue(u, k.ctx) > v);
}

/** No unseen pair (or triple, with width 3) in the suit is higher than `top`, so nothing of that shape can beat it. */
function bossTupleAt(top: number, suit: EffSuit, k: Know, width: number): boolean {
  return !tuplesOf(unseenIn(k, suit), width).some((p) => cardValue(p[0], k.ctx) > top);
}

function safeComp(comp: Component, suit: EffSuit, k: Know): boolean {
  return comp.kind === 'single' ? bossSingle(comp.cards[0], k) : bossTupleAt(comp.top, suit, k, comp.width);
}

const partnerOf = (seat: number) => (seat + 2) % NUM_PLAYERS;
const opponentsOf = (seat: number) => [(seat + 1) % NUM_PLAYERS, (seat + 3) % NUM_PLAYERS];

/** Could any opponent still trump this side suit? (known void and trumps are still out there) */
function oppCanRuff(suit: EffSuit, k: Know): boolean {
  if (suit === 'T') return false;
  if (unseenIn(k, 'T').length === 0) return false;
  // If every other card of this suit is accounted for, nobody else holds any: anyone with a trump can take it.
  if (unseenIn(k, suit).length === 0) return true;
  return opponentsOf(k.seat).some((o) => k.voids[o].has(suit) && !k.voids[o].has('T'));
}

/** Could anyone else (opponent or partner) block a throw in this suit by trumping? */
function anyoneCanRuff(suit: EffSuit, k: Know): boolean {
  if (suit === 'T' || unseenIn(k, 'T').length === 0) return false;
  if (unseenIn(k, suit).length === 0) return true;
  return [1, 2, 3].map((i) => (k.seat + i) % 4).some((o) => k.voids[o].has(suit) && !k.voids[o].has('T'));
}

// ---------------------------------------------------------------------------------------------
// Leading

function groupBySuit(hand: Card[], ctx: TrumpCtx): Map<EffSuit, Card[]> {
  const m = new Map<EffSuit, Card[]>();
  for (const c of hand) {
    const s = effSuit(c, ctx);
    m.set(s, [...(m.get(s) ?? []), c]);
  }
  return m;
}

function smartLead(s: GameState, seat: number): Card[] {
  const k = knowledge(s, seat);
  const ctx = k.ctx;
  const hand = s.hands[seat];
  const groups = groupBySuit(hand, ctx);
  const sides = [...groups.entries()].filter(([suit]) => suit !== 'T');
  const trumps = groups.get('T') ?? [];
  const partner = partnerOf(seat);
  const defending = teamOf(seat) === teamOf(s.dealer!);

  // 1. Cash guaranteed winners in side suits the opponents can't ruff — as a throw when several are safe.
  let bestThrow: Card[] | null = null;
  for (const [suit, cards] of sides) {
    if (oppCanRuff(suit, k)) continue;
    let safe = decompose(cards, ctx).filter((c) => safeComp(c, suit, k));
    // A throw (several combos) can be blocked by anyone who can trump; then just cash the biggest safe combo.
    if (safe.length > 1 && anyoneCanRuff(suit, k)) safe = safe.slice(0, 1);
    const picked = safe.flatMap((c) => c.cards);
    if (picked.length && (!bestThrow || picked.length > bestThrow.length)) bestThrow = picked;
  }
  if (bestThrow) return bestThrow;

  // 2. Draw trumps when we hold the majority of what's left — strip opponents before cashing side suits.
  const trumpOut = unseenIn(k, 'T').length;
  if (trumps.length > 0 && trumpOut > 0 && trumps.length >= trumpOut * (defending ? 0.5 : 0.7)) {
    const comps = decompose(trumps, ctx);
    const safe = comps.filter((c) => safeComp(c, 'T', k));
    if (safe.length) return safe.flatMap((c) => c.cards);
    const pair = comps.filter((c) => c.kind !== 'single').sort((a, b) => a.top - b.top)[0];
    if (pair) return pair.cards;
  }

  // 3. Partner is void in a side suit (and could trump it) while opponents aren't: lead it for a ruff.
  for (const [suit, cards] of sides) {
    if (k.voids[partner].has(suit) && !k.voids[partner].has('T') && !oppCanRuff(suit, k)) {
      return [cards.slice().sort((a, b) => discardCost(a, ctx) - discardCost(b, ctx))[0]];
    }
  }

  // 4. Low side pairs/tractors force opponents to split their pairs.
  for (const [suit, cards] of sides) {
    if (oppCanRuff(suit, k)) continue;
    const comp = decompose(cards, ctx).find((c) => c.kind !== 'single' && totalPoints(c.cards) === 0 && c.top <= 6);
    if (comp) return comp.cards;
  }

  // 5. Low, pointless single from the shortest side suit (works toward a void we can ruff later).
  const ordered = sides.slice().sort((a, b) => a[1].length - b[1].length);
  for (const [suit, cards] of ordered) {
    if (oppCanRuff(suit, k) && ordered.length > 1) continue;
    const singles = cards.filter((c) => points(c) === 0 && !bossSingle(c, k)).sort(byValue(ctx));
    if (singles.length) return [singles[0]];
  }
  if (ordered.length) {
    return [ordered.flatMap(([, c]) => c).sort((a, b) => discardCost(a, ctx) - discardCost(b, ctx))[0]];
  }

  // 6. Only trumps left.
  const comps = decompose(trumps, ctx);
  const safe = comps.filter((c) => safeComp(c, 'T', k));
  if (safe.length) return safe.flatMap((c) => c.cards);
  const pair = comps.find((c) => c.kind !== 'single');
  return pair ? pair.cards : [trumps.sort(byValue(ctx))[0]];
}

// ---------------------------------------------------------------------------------------------
// Following

export function candidates(hand: Card[], lead: Card[], ctx: TrumpCtx): Card[][] {
  const n = lead.length;
  const suit = effSuit(lead[0], ctx);
  const suitCards = hand.filter((c) => effSuit(c, ctx) === suit);
  const out: Card[][] = [legalFollow(hand, lead, ctx, false), legalFollow(hand, lead, ctx, true)];
  if (n === 1) {
    const seen = new Set<string>();
    for (const c of hand) {
      if (!seen.has(cardKey(c))) out.push([c]);
      seen.add(cardKey(c));
    }
    return out;
  }
  const comps = decompose(lead, ctx);
  const pool = suitCards.length >= n ? suitCards : suitCards.length === 0 ? hand.filter((c) => isTrump(c, ctx)) : null;
  if (!pool || pool.length < n) return out;
  if (comps.length === 1 && comps[0].kind !== 'single') {
    const c = comps[0];
    const shapes = c.kind === 'tractor' ? tractorsOf(pool, c.len, ctx, c.width) : tuplesOf(pool, c.width);
    out.push(...shapes);
  } else if (pool !== suitCards) {
    // Ruffing a throw: build the matching structure out of our lowest trumps.
    let rest = pool.slice().sort(byValue(ctx));
    const shape: Card[] = [];
    for (const comp of comps) {
      const pick =
        comp.kind === 'single'
          ? rest.slice(0, 1)
          : comp.kind === 'tractor'
            ? tractorsOf(rest, comp.len, ctx, comp.width)[0]
            : tuplesOf(rest, comp.width).sort((a, b) => cardValue(a[0], ctx) - cardValue(b[0], ctx))[0];
      if (!pick?.length) return out;
      shape.push(...pick);
      const ids = new Set(pick.map((c) => c.id));
      rest = rest.filter((c) => !ids.has(c.id));
    }
    if (matchShape(shape, comps, ctx) !== null) out.push(shape);
  }
  return out;
}

/** Would `cards` still be winning after everyone left to play? Best guess from public info. */
function secure(s: GameState, k: Know, cards: Card[], laterSeats: number[]): boolean {
  const ctx = k.ctx;
  const opps = laterSeats.filter((x) => teamOf(x) !== teamOf(k.seat));
  if (opps.length === 0) return true;
  const leadSuit = effSuit(s.trick!.plays[0]?.cards[0] ?? cards[0], ctx);
  const suits = new Set(cards.map((c) => effSuit(c, ctx)));
  const playSuit = [...suits][0];
  const comps = decompose(cards, ctx);
  const top = comps[0];
  if (playSuit === 'T') {
    // A trump play is safe if nothing unseen in trump could top its largest component.
    return safeComp(top, 'T', k);
  }
  // A side-suit win is at risk from a ruff by a void opponent, or a higher card in suit.
  if (opps.some((o) => k.voids[o].has(leadSuit) && !k.voids[o].has('T'))) return false;
  return comps.every((c) => safeComp(c, leadSuit, k)) && suits.size === 1;
}

function smartFollow(s: GameState, seat: number): Card[] {
  const k = knowledge(s, seat);
  const ctx = k.ctx;
  const hand = s.hands[seat];
  const trick = s.trick!;
  const lead = trick.plays[0].cards;
  const played = new Set(trick.plays.map((p) => p.seat));
  const laterSeats: number[] = [];
  for (let i = 1; i < NUM_PLAYERS; i++) {
    const x = (seat + i) % NUM_PLAYERS;
    if (!played.has(x)) laterSeats.push(x);
  }
  const winner = trickWinner(trick.plays, ctx);
  const winnerCards = trick.plays.find((p) => p.seat === winner)!.cards;
  const partnerWinning = teamOf(winner) === teamOf(seat);

  const legal = candidates(hand, lead, ctx).filter((c) => c.length === lead.length && validateFollow(c, hand, lead, ctx) === null);
  const cost = (cards: Card[]) => cards.reduce((t, c) => t + strength(c, ctx), 0) + pairBreakCost(cards, hand, ctx);
  const pts = (cards: Card[]) => totalPoints(cards);
  const wins = (cards: Card[]) => trickWinner([...trick.plays, { seat, cards }], ctx) === seat;
  const pick = (list: Card[][], score: (c: Card[]) => number) => list.slice().sort((a, b) => score(a) - score(b))[0];
  const cheapest = (list: Card[][]) => pick(list, (c) => pts(c) * 6 + cost(c));

  if (partnerWinning && secure(s, k, winnerCards, laterSeats)) {
    // Feed points without wasting trumps or overtaking needlessly.
    return pick(legal, (c) => -pts(c) * 4 + cost(c) + (wins(c) ? 5 : 0));
  }

  const winning = legal.filter(wins);
  const lastToPlay = laterSeats.length === 0;
  const stake = trick.points;
  if (winning.length) {
    const safeWins = winning.filter((c) => secure(s, k, c, laterSeats));
    const usesTrump = (c: Card[]) => c.some((x) => isTrump(x, ctx)) && effSuit(lead[0], ctx) !== 'T';
    const worth = (c: Card[]) => stake + pts(c) >= 10 || !usesTrump(c) || lead.length > 1 || hand.length <= 6;
    if (lastToPlay) {
      const ok = winning.filter((c) => worth(c) || stake > 0);
      if (ok.length) return pick(ok, (c) => cost(c) - pts(c) * 2);
    } else if (safeWins.length) {
      const ok = safeWins.filter(worth);
      if (ok.length) return pick(ok, (c) => cost(c) - pts(c) * 2);
    } else if (!partnerWinning && stake >= 10) {
      // Contest a valuable trick even without a guarantee, but don't throw points into it.
      return pick(winning, (c) => cost(c) + pts(c) * 6);
    }
  }
  // Can't (or shouldn't) win: if partner is ahead but not secure, still keep points back.
  return cheapest(legal);
}

export function botPlay(s: GameState, seat: number): string[] {
  const cards = s.trick!.plays.length === 0 ? smartLead(s, seat) : smartFollow(s, seat);
  return cards.map((c) => c.id);
}

// ---------------------------------------------------------------------------------------------
// Burying & declaring

/** Bury to create voids (for ruffing) while keeping trumps, aces, pairs and — mostly — points. */
export function botBury(s: GameState, seat: number): string[] {
  const ctx = ctxOf(s);
  const hand = s.hands[seat];
  const counts = new Map<string, number>();
  for (const c of hand) counts.set(cardKey(c), (counts.get(cardKey(c)) ?? 0) + 1);
  const groups = groupBySuit(hand, ctx);
  const cost = (c: Card) => {
    if (isTrump(c, ctx)) return 1000 + cardValue(c, ctx);
    const len = groups.get(effSuit(c, ctx))!.length;
    return (
      len * 6 + // short suits first, so we can void them
      cardValue(c, ctx) * 2 +
      points(c) * 4 +
      (counts.get(cardKey(c))! > 1 ? 60 : 0) +
      (c.rank === 14 ? 80 : 0)
    );
  };
  return hand
    .slice()
    .sort((a, b) => cost(a) - cost(b))
    .slice(0, rulesOf(s).kitty)
    .map((c) => c.id);
}

export interface DeclareParams {
  /** don't declare before holding this many cards */
  minDealt: number;
  /** strength needed when nobody has declared / an opponent has / the partner has */
  thNone: number;
  thOpp: number;
  thPartner: number;
  /** bonus for declaring with a pair (harder to override) */
  pairBonus: number;
  /** how much a joker counts toward trump strength */
  jokerWeight: number;
  /** also consider declaring in the last-chance window after the deal, needing `lateTh` */
  late: boolean;
  lateTh: number;
}

/** Current settings (see scripts/ml/declare.ts for how they're tuned). */
export const DECLARE_PARAMS: DeclareParams = {
  // waits for 13 cards and may use the last-chance window: ~0.35 pts/round weaker than declaring from 7 cards,
  // but bots no longer declare on a handful of cards (user's choice)
  minDealt: 13,
  thNone: 0.47,
  thOpp: 0.38,
  thPartner: 0.71,
  pairBonus: 0.05,
  jokerWeight: 1.06,
  late: true,
  lateTh: 0.28,
};

/** Declare when the hand would be strong in that trump suit. */
export function botDeclare(s: GameState, seat: number, p: DeclareParams = DECLARE_PARAMS): DeclareOption | null {
  const lateWindow = s.phase === 'declaring';
  if (lateWindow && !p.late) return null;
  const opts = declareOptions(s, seat);
  if (opts.length === 0) return null;
  const hand = s.hands[seat];
  const dealt = hand.length;
  if (dealt < p.minDealt) return null;
  const jokers = hand.filter((c) => c.suit === 'J').length;
  const rankCards = hand.filter((c) => c.rank === s.trumpRank).length;
  const scored = opts.map((o) => {
    const suitLen = o.suit === 'NT' ? 0 : hand.filter((c) => c.suit === o.suit && c.rank !== s.trumpRank).length;
    const trumpCount = suitLen + jokers * p.jokerWeight + rankCards;
    return {
      o,
      score: trumpCount / dealt + (o.strength >= 2 ? p.pairBonus : 0) + (o.suit === 'NT' ? (jokers + rankCards) / dealt : 0),
    };
  });
  const best = scored.sort((a, b) => b.score - a.score)[0];
  const threshold = s.declaration
    ? s.declaration.seat === partnerOf(seat)
      ? p.thPartner
      : p.thOpp
    : lateWindow
      ? p.lateTh
      : p.thNone;
  return best.score >= threshold ? best.o : null;
}

/** Hint for humans: what a strong bot would play here. */
export function suggest(s: GameState, seat: number): string[] {
  return botPlay(s, seat);
}

// ---------------------------------------------------------------------------------------------
// A deliberately simple baseline, used by the simulator to measure the strong bot.

export function basicPlay(s: GameState, seat: number): string[] {
  const ctx = ctxOf(s);
  const hand = s.hands[seat];
  const trick = s.trick!;
  if (trick.plays.length === 0) {
    const groups = [...groupBySuit(hand, ctx).entries()].filter(([x]) => x !== 'T');
    const pick = groups.length ? groups[0][1] : hand;
    return [pick.slice().sort(byValue(ctx))[pick.length - 1].id];
  }
  return legalFollow(hand, trick.plays[0].cards, ctx).map((c) => c.id);
}
