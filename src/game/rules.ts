import { BIG_JOKER, Card, cardKey, Suit } from './cards';

/** Trump context for a round. suit: null while undecided (treated like no-trump for sorting). */
export interface TrumpCtx {
  suit: Suit | 'NT' | null;
  rank: number;
}

/** Effective suit: 'T' for trump, otherwise the card's printed suit. */
export type EffSuit = Suit | 'T';

export function isTrump(card: Card, ctx: TrumpCtx): boolean {
  return card.suit === 'J' || card.rank === ctx.rank || card.suit === ctx.suit;
}

export function effSuit(card: Card, ctx: TrumpCtx): EffSuit {
  return isTrump(card, ctx) ? 'T' : (card.suit as Suit);
}

/** Rank index with the trump rank removed, so e.g. 6-8 are adjacent when 7 is trump rank. */
function compIdx(rank: number, level: number): number {
  return rank - 2 - (rank > level ? 1 : 0);
}

/**
 * Ordering value within the card's effective suit. Consecutive values form tractors.
 * Trump order: suit cards (0..11) < off-suit rank cards (12) < trump-suit rank card (13) < small joker < big joker.
 */
export function cardValue(card: Card, ctx: TrumpCtx): number {
  const hasSuit = ctx.suit !== null && ctx.suit !== 'NT';
  if (card.suit === 'J') {
    const base = hasSuit ? 14 : 13;
    return card.rank === BIG_JOKER ? base + 1 : base;
  }
  if (card.rank === ctx.rank) return hasSuit && card.suit === ctx.suit ? 13 : 12;
  return compIdx(card.rank, ctx.rank);
}

export type CompKind = 'single' | 'pair' | 'tractor';
export interface Component {
  kind: CompKind;
  /** number of pairs for pair/tractor; 1 for single */
  len: number;
  cards: Card[];
  top: number;
  size: number;
}

function groupIdentical(cards: Card[]): Map<string, Card[]> {
  const m = new Map<string, Card[]>();
  for (const c of cards) {
    const k = cardKey(c);
    const g = m.get(k);
    if (g) g.push(c);
    else m.set(k, [c]);
  }
  return m;
}

/** Splits cards into (pairs, singles). */
function pairsAndSingles(cards: Card[]): { pairs: Card[][]; singles: Card[] } {
  const pairs: Card[][] = [];
  const singles: Card[] = [];
  for (const g of groupIdentical(cards).values()) {
    let i = 0;
    for (; i + 1 < g.length; i += 2) pairs.push([g[i], g[i + 1]]);
    if (i < g.length) singles.push(g[i]);
  }
  return { pairs, singles };
}

export function countPairs(cards: Card[]): number {
  return pairsAndSingles(cards).pairs.length;
}

/** Maximal runs of consecutive pair values: [start, end] inclusive. */
function pairRuns(cards: Card[], ctx: TrumpCtx): [number, number][] {
  const vals = [...new Set(pairsAndSingles(cards).pairs.map((p) => cardValue(p[0], ctx)))].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const v of vals) {
    const last = runs[runs.length - 1];
    if (last && v === last[1] + 1) last[1] = v;
    else runs.push([v, v]);
  }
  return runs;
}

export function longestTractor(cards: Card[], ctx: TrumpCtx): number {
  return Math.max(0, ...pairRuns(cards, ctx).map(([s, e]) => e - s + 1));
}

function compSort(a: Component, b: Component): number {
  return b.size - a.size || b.top - a.top;
}

/** Decomposes same-suit cards into tractors, pairs and singles (largest first). */
export function decompose(cards: Card[], ctx: TrumpCtx): Component[] {
  const { pairs, singles } = pairsAndSingles(cards);
  const byVal = new Map<number, Card[][]>();
  for (const p of pairs) {
    const v = cardValue(p[0], ctx);
    byVal.set(v, [...(byVal.get(v) ?? []), p]);
  }
  const comps: Component[] = [];
  for (;;) {
    const vals = [...byVal.keys()].filter((v) => byVal.get(v)!.length > 0).sort((a, b) => a - b);
    if (vals.length === 0) break;
    let v = vals[0];
    const chain: Card[][] = [];
    while (byVal.get(v)?.length) {
      chain.push(byVal.get(v)!.shift()!);
      v++;
    }
    const top = v - 1;
    comps.push({
      kind: chain.length >= 2 ? 'tractor' : 'pair',
      len: chain.length,
      cards: chain.flat(),
      top,
      size: chain.length * 2,
    });
  }
  for (const s of singles) comps.push({ kind: 'single', len: 1, cards: [s], top: cardValue(s, ctx), size: 1 });
  return comps.sort(compSort);
}

function suitCards(cards: Card[], suit: EffSuit, ctx: TrumpCtx): Card[] {
  return cards.filter((c) => effSuit(c, ctx) === suit);
}

/** Can some combination in `hand` (restricted to `suit`) beat component `comp`? */
function beatable(comp: Component, hand: Card[], suit: EffSuit, ctx: TrumpCtx): boolean {
  const cards = suitCards(hand, suit, ctx);
  if (comp.kind === 'single') return cards.some((c) => cardValue(c, ctx) > comp.top);
  if (comp.kind === 'pair') {
    return pairsAndSingles(cards).pairs.some((p) => cardValue(p[0], ctx) > comp.top);
  }
  return pairRuns(cards, ctx).some(([s, e]) => e - s + 1 >= comp.len && e > comp.top);
}

export function validateLead(cards: Card[], ctx: TrumpCtx): string | null {
  if (cards.length === 0) return 'Select cards to lead';
  const s = effSuit(cards[0], ctx);
  if (!cards.every((c) => effSuit(c, ctx) === s)) return 'A lead must be all one suit (or all trump)';
  return null;
}

/**
 * For a multi-component lead ("throw"), every component must be unbeatable by every other hand.
 * Returns the component the leader is forced to play instead, or null if the throw stands.
 */
export function checkThrow(cards: Card[], others: Card[][], ctx: TrumpCtx): Component | null {
  const comps = decompose(cards, ctx);
  if (comps.length <= 1) return null;
  const suit = effSuit(cards[0], ctx);
  const failing = comps.filter((comp) => others.some((h) => beatable(comp, h, suit, ctx)));
  if (failing.length === 0) return null;
  return failing.sort((a, b) => a.size - b.size || a.top - b.top)[0];
}

export function validateFollow(play: Card[], hand: Card[], lead: Card[], ctx: TrumpCtx): string | null {
  const n = lead.length;
  if (play.length !== n) return `Play exactly ${n} card${n > 1 ? 's' : ''}`;
  const suit = effSuit(lead[0], ctx);
  const handSuit = suitCards(hand, suit, ctx);
  const playSuit = suitCards(play, suit, ctx);
  const suitName = suit === 'T' ? 'trump' : { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }[suit];
  if (handSuit.length <= n) {
    return playSuit.length === handSuit.length ? null : `You must play all your ${suitName}`;
  }
  if (playSuit.length !== n) return `You must follow with ${suitName}`;

  const comps = decompose(lead, ctx);
  const leadPairs = comps.reduce((s, c) => s + (c.kind === 'single' ? 0 : c.len), 0);
  const leadTractor = Math.max(0, ...comps.filter((c) => c.kind === 'tractor').map((c) => c.len));
  if (leadTractor >= 2) {
    const handLong = longestTractor(handSuit, ctx);
    if (handLong >= 2) {
      const req = Math.min(leadTractor, handLong);
      if (longestTractor(playSuit, ctx) < req) return 'You must play your tractor';
    }
  }
  const reqPairs = Math.min(leadPairs, countPairs(handSuit));
  if (countPairs(playSuit) < reqPairs) return reqPairs === 1 ? 'You must play a pair' : `You must play ${reqPairs} pairs`;
  return null;
}

/**
 * Tries to carve the lead's structure out of `cards` (same effective suit), picking the strongest option
 * for each component. Returns the top value of the largest component, or null if the shape doesn't fit.
 */
export function matchShape(cards: Card[], leadComps: Component[], ctx: TrumpCtx): number | null {
  let remaining = cards.slice();
  let firstTop: number | null = null;
  const take = (picked: Card[]) => {
    const ids = new Set(picked.map((c) => c.id));
    remaining = remaining.filter((c) => !ids.has(c.id));
  };
  for (const comp of leadComps) {
    let top: number | null = null;
    if (comp.kind === 'single') {
      const best = remaining.slice().sort((a, b) => cardValue(b, ctx) - cardValue(a, ctx))[0];
      if (!best) return null;
      top = cardValue(best, ctx);
      take([best]);
    } else {
      const pairs = pairsAndSingles(remaining).pairs;
      if (comp.kind === 'pair') {
        const best = pairs.sort((a, b) => cardValue(b[0], ctx) - cardValue(a[0], ctx))[0];
        if (!best) return null;
        top = cardValue(best[0], ctx);
        take(best);
      } else {
        const runs = pairRuns(remaining, ctx).filter(([s, e]) => e - s + 1 >= comp.len);
        if (runs.length === 0) return null;
        const end = Math.max(...runs.map((r) => r[1]));
        top = end;
        const picked: Card[] = [];
        for (let v = end - comp.len + 1; v <= end; v++) {
          picked.push(...pairs.find((p) => cardValue(p[0], ctx) === v)!);
        }
        take(picked);
      }
    }
    if (firstTop === null) firstTop = top;
  }
  return firstTop;
}

export interface PlayLike {
  seat: number;
  cards: Card[];
}

export function trickWinner(plays: PlayLike[], ctx: TrumpCtx): number {
  const lead = plays[0].cards;
  const leadSuit = effSuit(lead[0], ctx);
  const comps = decompose(lead, ctx);
  let best = { seat: plays[0].seat, trump: leadSuit === 'T', top: comps[0].top };
  for (const p of plays.slice(1)) {
    const suits = new Set(p.cards.map((c) => effSuit(c, ctx)));
    if (suits.size !== 1) continue;
    const s = [...suits][0];
    if (s === leadSuit) {
      if (comps.length > 1) continue; // a standing throw can't be beaten in-suit
      const top = matchShape(p.cards, comps, ctx);
      if (top !== null && best.trump === (s === 'T') && top > best.top) best = { seat: p.seat, trump: s === 'T', top };
    } else if (s === 'T') {
      const top = matchShape(p.cards, comps, ctx);
      if (top === null) continue;
      if (!best.trump || top > best.top) best = { seat: p.seat, trump: true, top };
    }
  }
  return best.seat;
}

const SUIT_ORDER: Suit[] = ['S', 'H', 'C', 'D'];

/** Hand order: non-trump suits alternating colour, then trumps (strongest on the right). */
export function sortHand(cards: Card[], ctx: TrumpCtx): Card[] {
  const groupOf = (c: Card) => {
    const s = effSuit(c, ctx);
    return s === 'T' ? 10 : SUIT_ORDER.indexOf(s);
  };
  return cards.slice().sort(
    (a, b) =>
      groupOf(a) - groupOf(b) ||
      cardValue(a, ctx) - cardValue(b, ctx) ||
      SUIT_ORDER.indexOf(a.suit as Suit) - SUIT_ORDER.indexOf(b.suit as Suit) ||
      a.id.localeCompare(b.id),
  );
}

