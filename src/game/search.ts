/*
 * Determinized Monte Carlo search for the bots.
 *
 * For each sensible move, deal the hidden cards many ways that are consistent with everything this seat can
 * legitimately know (its own hand, every card played, its buried kitty if it's the dealer, how many cards each
 * player holds, and the suits players have shown they're out of), play the rest of the round out with the
 * heuristic bot, and pick the move with the best average result for this seat's team. Every move is scored on
 * the same set of deals, so the comparison isn't swamped by luck of the deal. The bot never looks at real
 * hidden hands — only at random guesses of them.
 */
import { botPlay, candidates } from './bot';
import { Card, cardKey, makeDecks, points, shuffle } from './cards';
import { checkPlay, collectTrick, ctxOf, GameState, play } from './engine';
import { cardValue, decompose, effSuit, trickWinner } from './rules';
import { knownLocations } from './info';

const noName = () => '';

/**
 * Tuned by duplicate matches (same deals played twice with teams swapped, so card luck cancels):
 * searching leads with 48 sampled deals beat the heuristic bot by +3.7 ± 2.2 points per round over 200 deals,
 * about as much as searching every move, at a fraction of the cost. Follows use the heuristic bot.
 */
export const SEARCH_SAMPLES = 48;
const SUITS = ['S', 'H', 'C', 'D', 'T'];

export function cloneState(s: GameState): GameState {
  return structuredClone(s);
}

/** A random deal of the hidden cards consistent with what `seat` knows. */
export function determinize(s: GameState, seat: number): GameState {
  const d = cloneState(s);
  const known = new Set<string>([...s.hands[seat], ...s.played].map((c) => c.id));
  if (seat === s.dealer) for (const c of s.kitty) known.add(c.id);
  const pins = knownLocations(s, seat);
  const pool = makeDecks(2).filter((c) => !known.has(c.id) && !pins.has(c.id));
  const ctx = ctxOf(s);
  // Recipients of hidden cards: the other players (who can't hold suits they've shown they lack), and the kitty.
  const recips = [0, 1, 2, 3]
    .filter((o) => o !== seat)
    .map((o) => {
      // cards we know this player holds (shown when declaring, or taken back from a blocked throw)
      const got = makeDecks(2).filter((c) => pins.get(c.id) === o);
      return { who: o as number | 'kitty', cap: s.hands[o].length - got.length, ok: (suit: string) => !s.voids[o].includes(suit), got };
    });
  if (seat !== s.dealer) recips.push({ who: 'kitty', cap: s.kitty.length, ok: () => true, got: [] });
  const cnt: Record<string, number> = Object.fromEntries(SUITS.map((x) => [x, 0]));
  for (const c of pool) cnt[effSuit(c, ctx)]++;
  // Supply/demand (Hall) condition: every set of suits must fit into the recipients allowed to hold them.
  const feasible = () => {
    for (let mask = 1; mask < 1 << SUITS.length; mask++) {
      let need = 0;
      let room = 0;
      SUITS.forEach((x, i) => mask & (1 << i) && (need += cnt[x]));
      for (const r of recips) if (SUITS.some((x, i) => mask & (1 << i) && r.ok(x))) room += r.cap;
      if (need > room) return false;
    }
    return true;
  };
  if (!feasible()) throw new Error('hidden cards inconsistent with recorded voids');
  for (const c of shuffle(pool)) {
    const suit = effSuit(c, ctx);
    cnt[suit]--;
    let placed = false;
    for (const r of shuffle(recips.filter((r) => r.cap > 0 && r.ok(suit)))) {
      r.cap--;
      if (feasible()) {
        r.got.push(c);
        placed = true;
        break;
      }
      r.cap++;
    }
    if (!placed) throw new Error('could not determinize');
  }
  for (const r of recips) {
    if (r.who === 'kitty') d.kitty = r.got;
    else d.hands[r.who] = r.got;
  }
  return d;
}

/** Distinct sensible moves at a decision point. The heuristic bot's choice is always first. */
export function moveOptions(s: GameState, seat: number): string[][] {
  const ctx = ctxOf(s);
  const hand = s.hands[seat];
  const trick = s.trick!;
  const out = new Map<string, string[]>();
  const keyOf = (ids: string[]) =>
    hand
      .filter((c) => ids.includes(c.id))
      .map(cardKey)
      .sort()
      .join(',');
  const botMove = botPlay(s, seat);
  out.set(keyOf(botMove), botMove);
  const add = (cards: Card[]) => {
    const ids = cards.map((c) => c.id);
    if (checkPlay(s, seat, ids) === null && !out.has(keyOf(ids))) out.set(keyOf(ids), ids);
  };
  if (trick.plays.length === 0) {
    const bySuit = new Map<string, Card[]>();
    for (const c of hand) bySuit.set(effSuit(c, ctx), [...(bySuit.get(effSuit(c, ctx)) ?? []), c]);
    for (const cards of bySuit.values()) for (const comp of decompose(cards, ctx)) add(comp.cards);
  } else {
    for (const c of candidates(hand, trick.plays[0].cards, ctx)) add(c);
  }
  return [...out.values()];
}

/** Plays `move` and finishes the round with the heuristic bot; returns points from `seat`'s team's view. */
export function rollout(d: GameState, seat: number, move: string[]): number {
  if (play(d, seat, move, noName)) return 0;
  if (d.trick!.winner !== null) collectTrick(d, noName);
  while (d.phase === 'playing') {
    const t = d.turn;
    play(d, t, botPlay(d, t), noName);
    if (d.trick!.winner !== null) collectTrick(d, noName);
  }
  const attacking = seat % 2 !== d.dealer! % 2;
  return attacking ? d.result!.attackerPoints : -d.result!.attackerPoints;
}

/**
 * The search bot's move. `prior` is the move to keep unless the search finds a clearly better one (defaults to the
 * heuristic bot's choice). "Clearly better" is judged on paired results over the same sampled deals: the
 * alternative must win by more than 1.5 standard errors of the difference, so noise alone won't overturn the prior.
 */
export function searchPlay(s: GameState, seat: number, samples = 20, leadsOnly = false, prior?: string[]): string[] {
  if (leadsOnly && s.trick!.plays.length > 0) return prior ?? botPlay(s, seat);
  const options = moveOptions(s, seat);
  const keyOf = (ids: string[]) => [...ids].sort().join(',');
  let start = 0;
  if (prior) {
    start = options.findIndex((m) => keyOf(m) === keyOf(prior));
    if (start < 0) {
      options.push(prior);
      start = options.length - 1;
    }
  }
  if (options.length === 1) return options[0];
  try {
    const deals = Array.from({ length: samples }, () => determinize(s, seat));
    const scores = options.map((m) => deals.map((d) => rollout(cloneState(d), seat, m)));
    const mean = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / xs.length;
    let best = start;
    for (let i = 0; i < options.length; i++) {
      if (i === best) continue;
      const diff = scores[i].map((x, k) => x - scores[best][k]);
      const m = mean(diff);
      const se = Math.sqrt(diff.reduce((t, x) => t + (x - m) ** 2, 0) / Math.max(1, diff.length - 1) / diff.length);
      // Hints (with a prior) need a significant win; the bots keep the simple margin they were tested with.
      if (m > (prior ? Math.max(0.5, 1.5 * se) : 0.5)) best = i;
    }
    return options[best];
  } catch {
    return options[start];
  }
}

/**
 * Anytime version of searchPlay for live bots: keeps sampling deals until `budgetMs` is spent (at least
 * `minSamples`, at most `maxSamples`), playing every option on each sampled deal. The bots' natural "thinking" pause
 * covers this time, so a deeper search doesn't add visible delay.
 */
export function searchPlayTimed(
  s: GameState,
  seat: number,
  budgetMs: number,
  prior?: string[],
  minSamples = 16,
  maxSamples = 400,
): string[] {
  const options = moveOptions(s, seat);
  const keyOf = (ids: string[]) => [...ids].sort().join(',');
  let start = 0;
  if (prior) {
    start = options.findIndex((m) => keyOf(m) === keyOf(prior));
    if (start < 0) {
      options.push(prior);
      start = options.length - 1;
    }
  }
  if (options.length === 1) return options[0];
  const t0 = Date.now();
  const scores: number[][] = options.map(() => []);
  try {
    while (scores[0].length < maxSamples && (scores[0].length < minSamples || Date.now() - t0 < budgetMs)) {
      const d = determinize(s, seat);
      options.forEach((m, i) => scores[i].push(rollout(cloneState(d), seat, m)));
    }
  } catch {
    if (scores[0].length < minSamples) return options[start];
  }
  const mean = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / xs.length;
  let best = start;
  for (let i = 0; i < options.length; i++) {
    if (i === best) continue;
    const diff = scores[i].map((x, k) => x - scores[best][k]);
    const m = mean(diff);
    const se = Math.sqrt(diff.reduce((t, x) => t + (x - m) ** 2, 0) / Math.max(1, diff.length - 1) / diff.length);
    if (m > Math.max(0.5, 1.5 * se)) best = i;
  }
  return options[best];
}

/**
 * When no opponent plays after `seat` in this trick, the trick's outcome is already settled by what's on the table,
 * so there's nothing to simulate: feed the most points when our team is winning, give the fewest when we can't win.
 * The card-counting heuristic does exactly this (it also avoids splitting pairs and wasting trumps). Search and the
 * learned model can blur a certain gain now with noisy guesses about later tricks, so they defer to it here.
 */
export function settledTrickMove(s: GameState, seat: number): string[] | null {
  const trick = s.trick!;
  if (trick.plays.length === 0) return null;
  const played = new Set(trick.plays.map((p) => p.seat));
  for (let i = 1; i < 4; i++) {
    const x = (seat + i) % 4;
    if (!played.has(x) && x % 2 !== seat % 2) return null;
  }
  return botPlay(s, seat);
}

/**
 * The narrow, clear-cut case of settledTrickMove: our partner is winning the trick and no opponent plays after us, so
 * the trick is ours whatever we play. The heuristic feeds it the most points it can spare.
 */
export function feedTrickMove(s: GameState, seat: number): string[] | null {
  const trick = s.trick!;
  if (trick.plays.length === 0) return null;
  if (trickWinner(trick.plays, ctxOf(s)) !== (seat + 2) % 4) return null;
  return settledTrickMove(s, seat);
}

/**
 * Never follow with a higher card than needed: swap each card of the move for a lower card of the same suit from the
 * hand when that's legal, gives the same points, doesn't split a pair, and doesn't change who's winning the trick.
 * The search scores moves by noisy simulated futures, so it sometimes can't tell a 7 from a 2 — but keeping the 7
 * is never worse.
 */
export function keepHighCards(s: GameState, seat: number, ids: string[]): string[] {
  const trick = s.trick!;
  if (trick.plays.length === 0) return ids;
  const ctx = ctxOf(s);
  const hand = s.hands[seat];
  const count = (cards: Card[], c: Card) => cards.filter((x) => cardKey(x) === cardKey(c)).length;
  const winnerWith = (move: string[]) =>
    trickWinner([...trick.plays, { seat, cards: hand.filter((c) => move.includes(c.id)) }], ctx);
  const target = winnerWith(ids);
  let move = [...ids];
  for (let changed = true; changed; ) {
    changed = false;
    const cards = hand.filter((c) => move.includes(c.id)).sort((a, b) => cardValue(b, ctx) - cardValue(a, ctx));
    for (const x of cards) {
      if (count(cards, x) > 1) continue; // part of a pair we're playing
      const lower = hand
        .filter(
          (y) =>
            !move.includes(y.id) &&
            effSuit(y, ctx) === effSuit(x, ctx) &&
            cardValue(y, ctx) < cardValue(x, ctx) &&
            points(y) === points(x) &&
            count(hand, y) === 1,
        )
        .sort((a, b) => cardValue(a, ctx) - cardValue(b, ctx));
      for (const y of lower) {
        const next = move.map((id) => (id === x.id ? y.id : id));
        if (checkPlay(s, seat, next) || winnerWith(next) !== target) continue;
        move = next;
        changed = true;
        break;
      }
      if (changed) break;
    }
  }
  return move;
}

/**
 * When no legal move wins the trick right now and our partner isn't currently winning it, this is a pure discard:
 * the card-counting heuristic dumps the cheapest cards (protecting pairs, trumps and points). The learned model has a
 * blind spot here (it sometimes throws a higher pair), and the cost only shows up tricks later — too noisy for the
 * search to catch — so defer to the heuristic.
 */
export function hopelessTrickMove(s: GameState, seat: number): string[] | null {
  const trick = s.trick!;
  if (trick.plays.length === 0) return null;
  const ctx = ctxOf(s);
  if (trickWinner(trick.plays, ctx) % 2 === seat % 2) return null;
  const canWin = moveOptions(s, seat).some((m) => {
    const cards = s.hands[seat].filter((c) => m.includes(c.id));
    return trickWinner([...trick.plays, { seat, cards }], ctx) === seat;
  });
  return canWin ? null : botPlay(s, seat);
}

/**
 * The starting move ("prior") the search checks. Normally the learned model's move, but if that move would leave the
 * trick with the opponents, use the card-counting heuristic's instead: when you're not winning a trick, the job is to
 * lose as little as possible (no points to the opponents, keep pairs and high trumps), which the heuristic does
 * reliably and the model sometimes doesn't.
 */
export function priorMove(s: GameState, seat: number, learned: string[]): string[] {
  const trick = s.trick!;
  if (trick.plays.length === 0) return learned;
  const ctx = ctxOf(s);
  const cards = s.hands[seat].filter((c) => learned.includes(c.id));
  const winner = trickWinner([...trick.plays, { seat, cards }], ctx);
  return winner % 2 === seat % 2 ? learned : botPlay(s, seat);
}
