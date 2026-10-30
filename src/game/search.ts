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
import { Card, cardKey, makeDecks, shuffle } from './cards';
import { checkPlay, collectTrick, ctxOf, GameState, play } from './engine';
import { decompose, effSuit } from './rules';

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
  const pool = makeDecks(2).filter((c) => !known.has(c.id));
  const ctx = ctxOf(s);
  // Recipients of hidden cards: the other players (who can't hold suits they've shown they lack), and the kitty.
  const recips = [0, 1, 2, 3]
    .filter((o) => o !== seat)
    .map((o) => ({ who: o as number | 'kitty', cap: s.hands[o].length, ok: (suit: string) => !s.voids[o].includes(suit), got: [] as Card[] }));
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

/** The search bot's move. Falls back to the heuristic bot if there's nothing to decide or search fails. */
export function searchPlay(s: GameState, seat: number, samples = 20, leadsOnly = false): string[] {
  if (leadsOnly && s.trick!.plays.length > 0) return botPlay(s, seat);
  const options = moveOptions(s, seat);
  if (options.length === 1) return options[0];
  try {
    const deals = Array.from({ length: samples }, () => determinize(s, seat));
    const means = options.map((m) => deals.reduce((t, d) => t + rollout(cloneState(d), seat, m), 0) / samples);
    // Prefer the heuristic move unless another option is genuinely better (guards against noise).
    let best = 0;
    for (let i = 1; i < options.length; i++) if (means[i] > means[best] + 0.5) best = i;
    return options[best];
  } catch {
    return options[0];
  }
}
