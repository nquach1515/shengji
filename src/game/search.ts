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
import { botPlay, candidates, keepTriples, splitWins } from './bot';
import { Card, cardKey, makeDecks, points, shuffle, totalPoints } from './cards';
import { checkPlay, collectTrick, ctxOf, DeckRules, decksOf, GameState, play, roundLevels, rulesFor, rulesOf } from './engine';
import { cardValue, decompose, effSuit, isTrump, matchShape, trickWinner, tuplesOf, validateFollow } from './rules';
import { playReader, ReadParams } from './inference';
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
  // Deals that also respect who has shown they hold no pairs (or triples) in a suit; that can rarely fail to fit,
  // so after a few tries fall back to respecting voids alone.
  for (let i = 0; i < 20; i++) {
    const d = deal(s, seat, true);
    if (d) return d;
  }
  return deal(s, seat, false)!;
}

function deal(s: GameState, seat: number, useCopies: boolean): GameState | null {
  const d = cloneState(s);
  const known = new Set<string>([...s.hands[seat], ...s.played].map((c) => c.id));
  if (seat === s.dealer) for (const c of s.kitty) known.add(c.id);
  const pins = knownLocations(s, seat);
  const pool = makeDecks(decksOf(s)).filter((c) => !known.has(c.id) && !pins.has(c.id));
  const ctx = ctxOf(s);
  // Recipients of hidden cards: the other players (who can't hold suits they've shown they lack), and the kitty.
  const recips = [0, 1, 2, 3]
    .filter((o) => o !== seat)
    .map((o) => {
      // cards we know this player holds (shown when declaring, or taken back from a blocked throw)
      const got = makeDecks(decksOf(s)).filter((c) => pins.get(c.id) === o);
      const max = useCopies ? (s.maxCopies?.[o] ?? {}) : {};
      return { who: o as number | 'kitty', cap: s.hands[o].length - got.length, ok: (suit: string) => !s.voids[o].includes(suit), got, max };
    });
  if (seat !== s.dealer) recips.push({ who: 'kitty', cap: s.kitty.length, ok: () => true, got: [], max: {} as Record<string, number> });
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
    const key = cardKey(c);
    const fits = (r: (typeof recips)[number]) =>
      r.max[suit] === undefined || r.got.filter((g) => cardKey(g) === key).length < r.max[suit];
    for (const r of shuffle(recips.filter((r) => r.cap > 0 && r.ok(suit) && fits(r)))) {
      r.cap--;
      if (feasible()) {
        r.got.push(c);
        placed = true;
        break;
      }
      r.cap++;
    }
    if (!placed) {
      if (useCopies) return null;
      throw new Error('could not determinize');
    }
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
  // bots split a triple only when every option does, or to take a trick with points from the opponents
  const cardsOf = (ids: string[]) => hand.filter((c) => ids.includes(c.id));
  return keepTriples(hand, [...out.values()], cardsOf, (ids) => splitWins(s, seat, cardsOf(ids)));
}

/** Plays `move` and finishes the round with the heuristic bot; returns points from `seat`'s team's view. */
/** How much the live search values the level outcome against raw points (see attackerValue). */
export const LEVEL_WEIGHT = 20;

/**
 * A round's value from the attackers' side: their points, plus `levelWeight` per level the attackers gain (or minus
 * per level the defenders gain), plus or minus `levelWeight / 2` for who deals next. Mirrors endRound's scoring.
 */
export function attackerValue(points: number, levelWeight: number, r: DeckRules = rulesFor(2)): number {
  const { attackersWin, gained } = roundLevels(points, r);
  return points + (attackersWin ? 1 : -1) * levelWeight * (gained + 0.5);
}

export function rollout(d: GameState, seat: number, move: string[], levelWeight = 0): number {
  if (play(d, seat, move, noName)) return 0;
  if (d.trick!.winner !== null) collectTrick(d, noName);
  while (d.phase === 'playing') {
    const t = d.turn;
    play(d, t, botPlay(d, t), noName);
    if (d.trick!.winner !== null) collectTrick(d, noName);
  }
  const attacking = seat % 2 !== d.dealer! % 2;
  const v = attackerValue(d.result!.attackerPoints, levelWeight, rulesOf(d));
  return attacking ? v : -v;
}

/**
 * Picks among `options` from paired playout results. Starting from `start` (the prior), an alternative must beat
 * the current best by `margin(se)`. With `logw` (from reading the other players' play) each sampled deal counts in
 * proportion to its likelihood, and the standard error uses the effective number of deals.
 */
function choose(scores: number[][], start: number, margin: (se: number) => number, logw?: number[]): number {
  const n = scores[0].length;
  let w: number[] | null = null;
  if (logw && logw.length === n) {
    const top = Math.max(...logw);
    w = logw.map((x) => Math.exp(x - top));
  }
  let best = start;
  for (let i = 0; i < scores.length; i++) {
    if (i === best) continue;
    const diff = scores[i].map((x, k) => x - scores[best][k]);
    let m: number;
    let se: number;
    if (!w) {
      m = diff.reduce((t, x) => t + x, 0) / n;
      se = Math.sqrt(diff.reduce((t, x) => t + (x - m) ** 2, 0) / Math.max(1, n - 1) / n);
    } else {
      const sw = w.reduce((t, x) => t + x, 0);
      m = diff.reduce((t, x, k) => t + w![k] * x, 0) / sw;
      const v = diff.reduce((t, x, k) => t + w![k] * (x - m) ** 2, 0) / sw;
      const ess = sw ** 2 / w.reduce((t, x) => t + x * x, 0);
      se = Math.sqrt(v / Math.max(1, ess - 1));
    }
    if (m > margin(se)) best = i;
  }
  return best;
}

/**
 * The search bot's move. `prior` is the move to keep unless the search finds a clearly better one (defaults to the
 * heuristic bot's choice). "Clearly better" is judged on paired results over the same sampled deals: the
 * alternative must win by more than 1.5 standard errors of the difference, so noise alone won't overturn the prior.
 */
export function searchPlay(s: GameState, seat: number, samples = 20, leadsOnly = false, prior?: string[], levelWeight = 0, read?: ReadParams): string[] {
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
    const scores = options.map((m) => deals.map((d) => rollout(cloneState(d), seat, m, levelWeight)));
    const reader = playReader(s, seat, read);
    const logw = reader ? deals.map(reader) : undefined;
    // Hints (with a prior) need a significant win; the bots keep the simple margin they were tested with.
    const best = choose(scores, start, (se) => (prior ? Math.max(0.5, 1.5 * se) : 0.5), logw);
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
  levelWeight = 0,
  read?: ReadParams,
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
  const reader = playReader(s, seat, read);
  const logw: number[] = [];
  try {
    while (scores[0].length < maxSamples && (scores[0].length < minSamples || Date.now() - t0 < budgetMs)) {
      const d = determinize(s, seat);
      const lw = reader ? reader(d) : 0;
      options.forEach((m, i) => scores[i].push(rollout(cloneState(d), seat, m, levelWeight)));
      logw.push(lw);
    }
  } catch {
    if (scores[0].length < minSamples) return options[start];
  }
  const n = Math.min(...scores.map((x) => x.length));
  for (const x of scores) x.length = n;
  const best = choose(scores, start, (se) => Math.max(0.5, 1.5 * se), reader ? logw.slice(0, n) : undefined);
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

// ---------------------------------------------------------------------------------------------
// Card counting: how likely is a single card to hold up against the players still to play?

/** Chance that a hand of `h` cards dealt from `n` unknown cards contains none of `k` particular ones. */
function noneOf(n: number, k: number, h: number): number {
  let p = 1;
  for (let i = 0; i < h; i++) p *= Math.max(0, n - k - i) / (n - i);
  return p;
}

/**
 * Chance that `card`, currently winning a single-card trick, still wins once `laterSeats` have played — judged only
 * from what `seat` knows: the unseen cards are spread over the other hands (and the kitty, unless we're the dealer),
 * whose sizes are public. Each later opponent beats it by holding a higher card of its suit, or by being out of the
 * led suit (shown, or by chance — likelier the more of the suit has been played) while holding a trump.
 */
export function holdChance(s: GameState, seat: number, card: Card, leadSuit: string, laterSeats: number[]): number {
  const ctx = ctxOf(s);
  const hand = s.hands[seat];
  const seen = new Set([...hand, ...s.played, ...(seat === s.dealer ? s.kitty : [])].map((c) => c.id));
  const unseen = makeDecks(decksOf(s)).filter((c) => !seen.has(c.id));
  const n = unseen.length;
  const suit = effSuit(card, ctx);
  const inSuit = unseen.filter((c) => effSuit(c, ctx) === leadSuit).length;
  const higher = unseen.filter((c) => effSuit(c, ctx) === suit && cardValue(c, ctx) > cardValue(card, ctx)).length;
  const trumps = unseen.filter((c) => isTrump(c, ctx)).length;
  let hold = 1;
  for (const o of laterSeats) {
    if (o % 2 === seat % 2) continue; // partner
    const h = s.hands[o].length;
    const shownVoid = s.voids[o].includes(leadSuit as never);
    const shownNoTrump = s.voids[o].includes('T');
    // higher card in the same suit (only possible if they can follow; a ruffed card is beaten by any trump)
    const pHigher = suit === leadSuit && !shownVoid ? 1 - noneOf(n, higher, h) : 0;
    let pRuff = 0;
    if (leadSuit !== 'T' && suit !== 'T' && !shownNoTrump) {
      const pVoid = shownVoid ? 1 : noneOf(n, inSuit, h);
      pRuff = pVoid * (1 - noneOf(n - inSuit, trumps, h));
    }
    hold *= Math.max(0, 1 - pHigher - pRuff);
  }
  return hold;
}

/** How sure the partner must be that a trick holds before feeding it points, or before cashing a top card. */
export const HOLD_THRESHOLD = 0.65;

/**
 * Last to play, the opponents are winning a trick with points, and we can beat them: the result is certain, so take
 * it with the cheapest winning play (the heuristic's when it wins). The search can miss this: with whole-round
 * rollouts a certain 10 points now can stay inside its noise, and the model is reluctant to spend e.g. big jokers.
 * 2,000 duplicate deals (model in place of the search): +0.06 ± 0.19 points/round with 2 decks, +0.20 ± 0.19 with 3.
 */
export function takeLastTrickMove(s: GameState, seat: number): string[] | null {
  const trick = s.trick!;
  if (trick.plays.length !== 3 || trick.points === 0) return null;
  const ctx = ctxOf(s);
  if (trickWinner(trick.plays, ctx) % 2 === seat % 2) return null;
  const hand = s.hands[seat];
  const cardsOf = (m: string[]) => hand.filter((c) => m.includes(c.id));
  const wins = (m: string[]) => trickWinner([...trick.plays, { seat, cards: cardsOf(m) }], ctx) === seat;
  const winning = moveOptions(s, seat).filter(wins);
  if (winning.length === 0) return null;
  const heuristic = botPlay(s, seat);
  if (wins(heuristic)) return heuristic;
  const cost = (m: string[]) => cardsOf(m).reduce((t, c) => t + cardValue(c, ctx) + (isTrump(c, ctx) ? 20 : 0) - points(c) * 2, 0);
  return winning.sort((a, b) => cost(a) - cost(b))[0];
}

/**
 * Partner is winning and no opponent still to play can possibly beat it: feed the most points we can spare. "Can't
 * beat" is proven, not guessed: for each later opponent, no combination of the needed shape that ranks higher is
 * still unseen, or they've shown they're out of the suit or have no pairs (triples) left in it (GameState.maxCopies);
 * and the same for trumping in, unless trumps were led. E.g. partner's trump KK with no higher trump pair left
 * anywhere the opponents could hold one.
 */
export function feedSafeMove(s: GameState, seat: number): string[] | null {
  const trick = s.trick!;
  if (trick.plays.length === 0) return null;
  const ctx = ctxOf(s);
  const winner = trickWinner(trick.plays, ctx);
  if (winner !== (seat + 2) % 4) return null;
  const lead = trick.plays[0].cards;
  const comps = decompose(lead, ctx);
  if (comps.length !== 1) return null; // throws: leave to the other rules
  const { width } = comps[0];
  const leadSuit = effSuit(lead[0], ctx);
  const winCards = trick.plays.find((p) => p.seat === winner)!.cards;
  const winSuit = effSuit(winCards[0], ctx);
  const top = matchShape(winCards, comps, ctx);
  if (top === null) return null;
  const hand = s.hands[seat];
  const seen = new Set([...hand, ...s.played, ...(seat === s.dealer ? s.kitty : [])].map((c) => c.id));
  const unseen = makeDecks(decksOf(s)).filter((c) => !seen.has(c.id));
  // could opponent `o` hold a `width`-of-a-kind in `suit` ranking above `above`?
  const couldHold = (o: number, suit: string, above: number) =>
    !s.voids[o].includes(suit) &&
    (s.maxCopies?.[o]?.[suit] ?? Infinity) >= width &&
    tuplesOf(unseen.filter((c) => effSuit(c, ctx) === suit), width).some((t) => cardValue(t[0], ctx) > above);
  const played = new Set(trick.plays.map((p) => p.seat));
  const later = [1, 2, 3].map((i) => (seat + i) % 4).filter((x) => !played.has(x) && x % 2 !== seat % 2);
  for (const o of later) {
    if (winSuit === leadSuit && couldHold(o, leadSuit, top)) return null; // beat it in suit
    if (leadSuit !== 'T' && couldHold(o, 'T', winSuit === 'T' ? top : -1)) return null; // trump in (or over-trump)
  }
  const cardsOf = (m: string[]) => hand.filter((c) => m.includes(c.id));
  const count = new Map<string, number>();
  for (const c of hand) count.set(cardKey(c), (count.get(cardKey(c)) ?? 0) + 1);
  const score = (m: string[]) => {
    const cards = cardsOf(m);
    const used = new Map<string, number>();
    for (const c of cards) used.set(cardKey(c), (used.get(cardKey(c)) ?? 0) + 1);
    const broken = [...used].filter(([k, n]) => (count.get(k) ?? 0) >= 2 && n < count.get(k)!).length;
    const trumpsSpent = leadSuit === 'T' ? 0 : cards.filter((c) => isTrump(c, ctx)).length;
    return totalPoints(cards) * 10 - broken * 25 - trumpsSpent * 40 - cards.reduce((t, c) => t + cardValue(c, ctx), 0) * 0.1;
  };
  const best = moveOptions(s, seat).sort((a, b) => score(b) - score(a))[0];
  return best && totalPoints(cardsOf(best)) > 0 ? best : null;
}

/**
 * Partner is winning a single-card trick and, by card counting, will very likely keep it: play the most points we
 * can, without breaking a pair or spending a trump (unless trumps were led), preferring not to overtake partner.
 */
export function feedLikelyMove(s: GameState, seat: number, threshold = HOLD_THRESHOLD): string[] | null {
  const trick = s.trick!;
  if (trick.plays.length === 0 || trick.plays[0].cards.length !== 1) return null;
  const ctx = ctxOf(s);
  const winner = trickWinner(trick.plays, ctx);
  if (winner !== (seat + 2) % 4) return null;
  const lead = trick.plays[0].cards;
  const leadSuit = effSuit(lead[0], ctx);
  const played = new Set(trick.plays.map((p) => p.seat));
  const later = [1, 2, 3].map((i) => (seat + i) % 4).filter((x) => !played.has(x));
  const winCard = trick.plays.find((p) => p.seat === winner)!.cards[0];
  if (holdChance(s, seat, winCard, leadSuit, later) < threshold) return null;
  const hand = s.hands[seat];
  const legal = keepTriples(
    hand,
    candidates(hand, lead, ctx).filter((c) => c.length === 1 && validateFollow(c, hand, lead, ctx) === null),
    (c) => c,
  );
  if (legal.length === 0) return null;
  const count = new Map<string, number>();
  for (const c of hand) count.set(cardKey(c), (count.get(cardKey(c)) ?? 0) + 1);
  const score = ([c]: Card[]) =>
    points(c) * 10 -
    ((count.get(cardKey(c)) ?? 0) >= 2 ? 25 : 0) -
    (leadSuit !== 'T' && isTrump(c, ctx) ? 40 : 0) -
    (trickWinner([...trick.plays, { seat, cards: [c] }], ctx) === seat ? 3 : 0) -
    cardValue(c, ctx) * 0.1;
  const best = legal.slice().sort((a, b) => score(b) - score(a))[0];
  return totalPoints(best) > 0 ? best.map((c) => c.id) : null;
}

/**
 * Don't put points into a single-card trick our team is winning but will probably lose: when an opponent still plays
 * after us and, by card counting, our team's winning card is under `threshold` likely to hold, a move that adds
 * points is swapped for a legal move with fewer (the heuristic's if it qualifies, else the cheapest). The model can
 * play a 5 or 10 onto a partner's 9 with higher cards still out, and the search can't always tell it's worse.
 */
export function noRiskyPointsMove(s: GameState, seat: number, ids: string[], threshold = HOLD_THRESHOLD): string[] {
  const trick = s.trick!;
  if (trick.plays.length === 0 || trick.plays[0].cards.length !== 1) return ids;
  const hand = s.hands[seat];
  const cardsOf = (m: string[]) => hand.filter((c) => m.includes(c.id));
  const pts = totalPoints(cardsOf(ids));
  if (pts === 0) return ids;
  const ctx = ctxOf(s);
  const plays = [...trick.plays, { seat, cards: cardsOf(ids) }];
  const winner = trickWinner(plays, ctx);
  if (winner % 2 !== seat % 2) return ids;
  const played = new Set(plays.map((p) => p.seat));
  const later = [1, 2, 3].map((i) => (seat + i) % 4).filter((x) => !played.has(x));
  if (!later.some((x) => x % 2 !== seat % 2)) return ids;
  const leadSuit = effSuit(trick.plays[0].cards[0], ctx);
  const winCard = plays.find((p) => p.seat === winner)!.cards[0];
  if (holdChance(s, seat, winCard, leadSuit, later) >= threshold) return ids;
  const fewer = moveOptions(s, seat).filter((m) => totalPoints(cardsOf(m)) < pts);
  if (fewer.length === 0) return ids;
  const heuristic = botPlay(s, seat);
  if (fewer.some((m) => [...m].sort().join() === [...heuristic].sort().join())) return heuristic;
  const value = (m: string[]) => cardsOf(m).reduce((t, c) => t + cardValue(c, ctx) + (isTrump(c, ctx) ? 20 : 0), 0);
  return fewer.sort((a, b) => totalPoints(cardsOf(a)) - totalPoints(cardsOf(b)) || value(a) - value(b))[0];
}

/**
 * Don't lead a point card that can still be beaten: a single 5, 10 or K led while some unseen card of its suit
 * (trump included: e.g. a trump 10 with the jokers still out) ranks above it is swapped for a lead with fewer
 * points — the heuristic's if it qualifies, else the lowest pointless card of that suit, else the cheapest option.
 * Kept: point cards nothing unseen can beat, and side-suit leads our partner has shown they can trump.
 */
export function noRiskyPointLead(s: GameState, seat: number, ids: string[]): string[] {
  const trick = s.trick!;
  if (trick.plays.length !== 0 || ids.length !== 1) return ids;
  const hand = s.hands[seat];
  const card = hand.find((c) => c.id === ids[0]);
  if (!card || points(card) === 0) return ids;
  const ctx = ctxOf(s);
  const suit = effSuit(card, ctx);
  const seen = new Set([...hand, ...s.played, ...(seat === s.dealer ? s.kitty : [])].map((c) => c.id));
  const unseen = makeDecks(decksOf(s)).filter((c) => !seen.has(c.id));
  if (!unseen.some((c) => effSuit(c, ctx) === suit && cardValue(c, ctx) > cardValue(card, ctx))) return ids;
  const partner = (seat + 2) % 4;
  if (suit !== 'T' && s.voids[partner].includes(suit) && !s.voids[partner].includes('T')) return ids;
  const cardsOf = (m: string[]) => hand.filter((c) => m.includes(c.id));
  const fewer = moveOptions(s, seat).filter((m) => totalPoints(cardsOf(m)) < points(card));
  if (fewer.length === 0) return ids;
  const heuristic = botPlay(s, seat);
  if (fewer.some((m) => [...m].sort().join() === [...heuristic].sort().join())) return heuristic;
  const value = (m: string[]) => cardsOf(m).reduce((t, c) => t + cardValue(c, ctx) + (isTrump(c, ctx) ? 20 : 0), 0);
  const sameSuit = fewer.filter((m) => m.length === 1 && totalPoints(cardsOf(m)) === 0 && effSuit(cardsOf(m)[0], ctx) === suit);
  const pool = sameSuit.length ? sameSuit : fewer;
  return pool.sort((a, b) => totalPoints(cardsOf(a)) - totalPoints(cardsOf(b)) || value(a) - value(b))[0];
}

/**
 * Don't underlead a top card: leading a lower card of a side suit while holding a card of it nothing unseen can beat
 * (e.g. 6♦ from A♦ 6♦ with the other A♦ still out) lets an opponent win the trick, with their partner throwing points
 * on it. Unless an opponent has shown they can trump the suit, lead the top card instead. Measured neutral (2,000
 * duplicate deals: +0.15 ± 0.23 points/round with 2 decks, -0.00 ± 0.17 with 3), kept because the underlead looks
 * like a gift.
 */
export function noUnderlead(s: GameState, seat: number, ids: string[]): string[] {
  const trick = s.trick!;
  if (trick.plays.length !== 0 || ids.length !== 1) return ids;
  const hand = s.hands[seat];
  const card = hand.find((c) => c.id === ids[0]);
  if (!card) return ids;
  const ctx = ctxOf(s);
  const suit = effSuit(card, ctx);
  if (suit === 'T') return ids;
  if ([(seat + 1) % 4, (seat + 3) % 4].some((o) => s.voids[o].includes(suit) && !s.voids[o].includes('T'))) return ids;
  const seen = new Set([...hand, ...s.played, ...(seat === s.dealer ? s.kitty : [])].map((c) => c.id));
  const unseen = makeDecks(decksOf(s)).filter((c) => !seen.has(c.id) && effSuit(c, ctx) === suit);
  const top = hand
    .filter((c) => effSuit(c, ctx) === suit && cardValue(c, ctx) > cardValue(card, ctx) && !unseen.some((u) => cardValue(u, ctx) > cardValue(c, ctx)))
    .filter((c) => !hand.some((x) => x !== c && cardKey(x) === cardKey(c))) // a pair or triple is better led whole
    .sort((a, b) => cardValue(b, ctx) - cardValue(a, ctx))[0];
  return top && checkPlay(s, seat, [top.id]) === null ? [top.id] : ids;
}

/**
 * On lead holding the highest remaining card of a side suit: cash it while, by card counting, nobody is likely to
 * be able to trump it. Picks the suit with the most cards still out (least likely to be ruffed).
 */
export function cashTopCardMove(s: GameState, seat: number, threshold = HOLD_THRESHOLD): string[] | null {
  const trick = s.trick!;
  if (trick.plays.length !== 0) return null;
  const ctx = ctxOf(s);
  const hand = s.hands[seat];
  const later = [1, 2, 3].map((i) => (seat + i) % 4);
  let best: { card: Card; p: number } | null = null;
  for (const c of hand) {
    // a pair is better led as a pair than split
    if (isTrump(c, ctx) || hand.filter((x) => cardKey(x) === cardKey(c)).length >= 2) continue;
    const p = holdChance(s, seat, c, effSuit(c, ctx), later);
    if (p >= threshold && (!best || p > best.p)) best = { card: c, p };
  }
  return best ? [best.card.id] : null;
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
