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

export type CompKind = 'single' | 'pair' | 'triple' | 'tractor';
export interface Component {
  kind: CompKind;
  /** cards per unit: 1 single, 2 pair, 3 triple (a tractor is a chain of pairs or of triples) */
  width: number;
  /** number of units: 1, or the tractor's length */
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

/** Disjoint sets of `width` identical cards (a triple also yields one pair when width is 2). */
export function tuplesOf(cards: Card[], width: number): Card[][] {
  const out: Card[][] = [];
  for (const g of groupIdentical(cards).values()) {
    for (let i = 0; i + width <= g.length; i += width) out.push(g.slice(i, i + width));
  }
  return out;
}

export function countTuples(cards: Card[], width: number): number {
  return tuplesOf(cards, width).length;
}

/** Cards that are in a real pair: exactly two of a kind, not two of a triple. */
export function pairedCards(cards: Card[]): Card[] {
  return [...groupIdentical(cards).values()].filter((g) => g.length === 2).flat();
}

export function countPairs(cards: Card[]): number {
  return countTuples(cards, 2);
}

/** Maximal runs of consecutive values holding a `width`-tuple: [start, end] inclusive. */
function tupleRuns(cards: Card[], ctx: TrumpCtx, width: number): [number, number][] {
  const vals = [...new Set(tuplesOf(cards, width).map((p) => cardValue(p[0], ctx)))].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const v of vals) {
    const last = runs[runs.length - 1];
    if (last && v === last[1] + 1) last[1] = v;
    else runs.push([v, v]);
  }
  return runs;
}

/** Length of the longest tractor of pairs (or, with width 3, of triples). */
export function longestTractor(cards: Card[], ctx: TrumpCtx, width = 2): number {
  return Math.max(0, ...tupleRuns(cards, ctx, width).map(([s, e]) => e - s + 1));
}

/** Widest units first (triples, then pairs, then singles), then bigger, then higher. */
function compSort(a: Component, b: Component): number {
  return b.width - a.width || b.size - a.size || b.top - a.top;
}

/** Decomposes same-suit cards into tractors, triples, pairs and singles (largest first). */
export function decompose(cards: Card[], ctx: TrumpCtx): Component[] {
  const units = new Map<number, Card[][]>([
    [3, []],
    [2, []],
  ]);
  const comps: Component[] = [];
  for (const g of groupIdentical(cards).values()) {
    let i = 0;
    for (; i + 3 <= g.length; i += 3) units.get(3)!.push(g.slice(i, i + 3));
    if (g.length - i === 2) units.get(2)!.push(g.slice(i));
    else if (g.length - i === 1) comps.push({ kind: 'single', width: 1, len: 1, cards: [g[i]], top: cardValue(g[i], ctx), size: 1 });
  }
  for (const [width, tuples] of units) {
    const byVal = new Map<number, Card[][]>();
    for (const t of tuples) {
      const v = cardValue(t[0], ctx);
      byVal.set(v, [...(byVal.get(v) ?? []), t]);
    }
    for (;;) {
      const vals = [...byVal.keys()].filter((v) => byVal.get(v)!.length > 0).sort((a, b) => a - b);
      if (vals.length === 0) break;
      let v = vals[0];
      const chain: Card[][] = [];
      while (byVal.get(v)?.length) {
        chain.push(byVal.get(v)!.shift()!);
        v++;
      }
      comps.push({
        kind: chain.length >= 2 ? 'tractor' : width === 3 ? 'triple' : 'pair',
        width,
        len: chain.length,
        cards: chain.flat(),
        top: v - 1,
        size: chain.length * width,
      });
    }
  }
  return comps.sort(compSort);
}

function suitCards(cards: Card[], suit: EffSuit, ctx: TrumpCtx): Card[] {
  return cards.filter((c) => effSuit(c, ctx) === suit);
}

/** Can some combination in `hand` (restricted to `suit`) beat component `comp`? */
function beatable(comp: Component, hand: Card[], suit: EffSuit, ctx: TrumpCtx): boolean {
  const cards = suitCards(hand, suit, ctx);
  // House rule: a player who is out of the suit can block a throw with trumps that match a component's shape
  // (any trump for a single, a trump pair for a pair, a trump triple for a triple, a trump tractor for a tractor).
  if (cards.length === 0 && suit !== 'T') {
    return longestTractor(suitCards(hand, 'T', ctx), ctx, comp.width) >= comp.len;
  }
  return tupleRuns(cards, ctx, comp.width).some(([s, e]) => e - s + 1 >= comp.len && e > comp.top);
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

/** What a follow that has enough cards of the led suit must contain. */
export interface FollowDuties {
  /** a tractor of this width (2 pairs, 3 triples) and at least this length; 0 = none */
  tractorWidth: number;
  tractorLen: number;
  triples: number;
  /** pairs, counting each triple as one */
  pairs: number;
}

export function followDuties(lead: Card[], handSuit: Card[], ctx: TrumpCtx): FollowDuties {
  const comps = decompose(lead, ctx);
  const units = (width: number) => comps.reduce((t, c) => t + (c.width === width ? c.len : 0), 0);
  const triples = Math.min(units(3), countTuples(handSuit, 3));
  // Pairs (and pair tractors) are owed only from real pairs: nobody has to split a triple to answer a pair.
  // A triple you can't match still calls for a pair, like any pair in the lead; triples you play count as pairs.
  const realPairs = pairedCards(handSuit);
  const pairs = triples + Math.min(units(3) - triples + units(2), countPairs(realPairs));
  const duty = { tractorWidth: 0, tractorLen: 0, triples, pairs };
  const tractor = comps.find((c) => c.kind === 'tractor');
  if (!tractor) return duty;
  // A tractor must be answered with a tractor: of triples if you have one (for a triple tractor), else of pairs —
  // but someone giving triples for a triple tractor isn't also asked for a pair tractor (both may not fit).
  const widths = tractor.width === 2 ? [2] : triples > 0 ? [3] : [2];
  for (const width of widths) {
    const handLong = longestTractor(width === 2 ? realPairs : handSuit, ctx, width);
    if (handLong >= 2) return { ...duty, tractorWidth: width, tractorLen: Math.min(tractor.len, handLong) };
  }
  return duty;
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

  const duty = followDuties(lead, handSuit, ctx);
  if (duty.tractorLen && longestTractor(playSuit, ctx, duty.tractorWidth) < duty.tractorLen) return 'You must play your tractor';
  if (countTuples(playSuit, 3) < duty.triples) return duty.triples === 1 ? 'You must play a triple' : `You must play ${duty.triples} triples`;
  if (countPairs(playSuit) < duty.pairs) return duty.pairs === 1 ? 'You must play a pair' : `You must play ${duty.pairs} pairs`;
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
      const tuples = tuplesOf(remaining, comp.width);
      const runs = tupleRuns(remaining, ctx, comp.width).filter(([s, e]) => e - s + 1 >= comp.len);
      if (runs.length === 0) return null;
      const end = Math.max(...runs.map((r) => r[1]));
      top = end;
      const picked: Card[] = [];
      for (let v = end - comp.len + 1; v <= end; v++) picked.push(...tuples.find((p) => cardValue(p[0], ctx) === v)!);
      take(picked);
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

/**
 * Side suits in the order shown: red and black alternate whichever suits are present (black red black red, or
 * red black red when there are more reds), so neighbouring suits are easy to tell apart.
 */
function alternatingSuits(present: Suit[]): Suit[] {
  const blacks = present.filter((x) => x === 'S' || x === 'C');
  const reds = present.filter((x) => x === 'H' || x === 'D');
  const [first, second] = reds.length > blacks.length ? [reds, blacks] : [blacks, reds];
  const out: Suit[] = [];
  for (let i = 0; i < Math.max(first.length, second.length); i++) {
    if (first[i]) out.push(first[i]);
    if (second[i]) out.push(second[i]);
  }
  return out;
}

/** Hand order: side suits alternating colour, then trumps (strongest on the right). */
export function sortHand(cards: Card[], ctx: TrumpCtx): Card[] {
  const order = alternatingSuits(SUIT_ORDER.filter((x) => cards.some((c) => effSuit(c, ctx) === x)));
  const groupOf = (c: Card) => {
    const s = effSuit(c, ctx);
    return s === 'T' ? 10 : order.indexOf(s);
  };
  return cards.slice().sort(
    (a, b) =>
      groupOf(a) - groupOf(b) ||
      cardValue(a, ctx) - cardValue(b, ctx) ||
      SUIT_ORDER.indexOf(a.suit as Suit) - SUIT_ORDER.indexOf(b.suit as Suit) ||
      a.id.localeCompare(b.id),
  );
}

