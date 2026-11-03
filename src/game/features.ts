/*
 * Features describing a candidate move in context, for the learned move-scoring model.
 * Only information the acting seat legitimately has is used: its own hand, every card played, its buried kitty
 * (if dealer), hand sizes, and the suits other players have shown they're out of.
 */
import { Card, cardKey, makeDecks, totalPoints } from './cards';
import { ctxOf, decksOf, GameState, NUM_PLAYERS, rulesOf, teamOf } from './engine';
import { cardValue, decompose, effSuit, EffSuit, isTrump, TrumpCtx, trickWinner } from './rules';

export interface DecisionContext {
  s: GameState;
  seat: number;
  ctx: TrumpCtx;
  hand: Card[];
  unseen: Card[];
  lead: Card[] | null;
  leadSuit: EffSuit | null;
  laterSeats: number[];
  partnerWinning: boolean;
  attacking: boolean;
  /** heuristic bot's move ids, joined, to flag it */
  heuristicKey: string;
}

export function decisionContext(s: GameState, seat: number, heuristicMove: string[]): DecisionContext {
  const ctx = ctxOf(s);
  const hand = s.hands[seat];
  const seen = new Set<string>([...hand, ...s.played].map((c) => c.id));
  if (seat === s.dealer) for (const c of s.kitty) seen.add(c.id);
  const trick = s.trick!;
  const lead = trick.plays.length ? trick.plays[0].cards : null;
  const played = new Set(trick.plays.map((p) => p.seat));
  const laterSeats: number[] = [];
  for (let i = 1; i < NUM_PLAYERS; i++) {
    const x = (seat + i) % NUM_PLAYERS;
    if (!played.has(x)) laterSeats.push(x);
  }
  const winner = lead ? trickWinner(trick.plays, ctx) : null;
  return {
    s,
    seat,
    ctx,
    hand,
    unseen: makeDecks(decksOf(s)).filter((c) => !seen.has(c.id)),
    lead,
    leadSuit: lead ? effSuit(lead[0], ctx) : null,
    laterSeats,
    partnerWinning: winner !== null && teamOf(winner) === teamOf(seat),
    attacking: teamOf(seat) !== teamOf(s.dealer!),
    heuristicKey: [...heuristicMove].sort().join(','),
  };
}

export const FEATURE_NAMES = [
  'is_lead',
  'position_in_trick',
  'partner_winning',
  'trick_points',
  'attacking',
  'attacker_points',
  'hand_size',
  'lead_size',
  'lead_is_trump',
  'lead_has_pair',
  'my_cards_in_lead_suit',
  'my_trumps',
  'unseen_trumps',
  'later_opponent_can_ruff',
  'players_after_me',
  'is_dealer',
  'last_trick',
  'move_size',
  'move_trump_fraction',
  'move_avg_rank',
  'move_max_rank',
  'move_points',
  'wins_trick_now',
  'secure_win',
  'pairs_broken',
  'boss_card_fraction',
  'is_ruff',
  'off_suit_discard_fraction',
  'move_has_pair',
  'move_has_tractor',
  'move_is_throw',
  'my_length_in_move_suit',
  'opponent_void_in_move_suit',
  'partner_void_in_move_suit',
  'unseen_higher_in_move_suit',
  'heuristic_choice',
  'points_given_to_opponents',
  'points_fed_to_partner',
  'unseen_points',
  'dealer_kitty_points',
  'attacker_points_to_next_threshold',
  'attacker_points_vs_80',
  'unseen_in_move_suit',
  'unseen_points_in_move_suit',
  'unseen_in_lead_suit',
  'lead_has_triple',
  'move_has_triple',
  'triples_broken',
] as const;

const NF = FEATURE_NAMES.length;
export const FEATURE_COUNT = NF;

export function moveFeatures(dc: DecisionContext, move: Card[]): number[] {
  const { s, seat, ctx, hand, unseen, lead, leadSuit, laterSeats } = dc;
  const trick = s.trick!;
  const f = new Array<number>(NF).fill(0);
  const opps = [(seat + 1) % 4, (seat + 3) % 4];
  const partner = (seat + 2) % 4;
  const canRuff = (o: number, suit: EffSuit) => suit !== 'T' && s.voids[o].includes(suit) && !s.voids[o].includes('T');
  const unseenIn = (suit: EffSuit) => unseen.filter((c) => effSuit(c, ctx) === suit);
  // counts are scaled to a 2-deck game (1 with 2 decks, 1.5 with 3), so a feature means the same in both
  const r = rulesOf(s);
  const k = r.decks / 2;

  f[0] = lead ? 0 : 1;
  f[1] = trick.plays.length / 3;
  f[2] = dc.partnerWinning ? 1 : 0;
  f[3] = trick.points / 50;
  f[4] = dc.attacking ? 1 : 0;
  f[5] = s.attackerPoints / r.points;
  f[6] = hand.length / 25 / k;
  f[7] = lead ? lead.length / 8 : 0;
  f[8] = leadSuit === 'T' ? 1 : 0;
  f[9] = lead && decompose(lead, ctx).some((c) => c.kind !== 'single') ? 1 : 0;
  f[10] = leadSuit ? hand.filter((c) => effSuit(c, ctx) === leadSuit).length / 12 / k : 0;
  f[11] = hand.filter((c) => isTrump(c, ctx)).length / 20 / k;
  f[12] = unseenIn('T').length / 36 / k;
  f[13] = leadSuit && laterSeats.some((o) => opps.includes(o) && canRuff(o, leadSuit)) ? 1 : 0;
  f[14] = laterSeats.length / 3;
  f[15] = seat === s.dealer ? 1 : 0;
  f[16] = hand.length === move.length ? 1 : 0;

  const n = move.length;
  const values = move.map((c) => cardValue(c, ctx));
  f[17] = n / 8;
  f[18] = move.filter((c) => isTrump(c, ctx)).length / n;
  f[19] = values.reduce((t, v) => t + v, 0) / n / 15;
  f[20] = Math.max(...values) / 15;
  const pts = totalPoints(move);
  f[21] = pts / 40;

  const wins = lead ? trickWinner([...trick.plays, { seat, cards: move }], ctx) === seat : true;
  f[22] = wins ? 1 : 0;
  const moveSuits = new Set(move.map((c) => effSuit(c, ctx)));
  const moveSuit = moveSuits.size === 1 ? [...moveSuits][0] : null;
  const comps = moveSuit ? decompose(move, ctx) : [];
  // Secure: nothing unseen could top it in its suit, and no later opponent could ruff it.
  if (wins && moveSuit) {
    const shapeSafe = comps.every((c) => {
      const higher = unseenIn(moveSuit).filter((u) => cardValue(u, ctx) > c.top);
      if (c.kind === 'single') return higher.length === 0;
      const keys = new Map<string, number>();
      for (const u of higher) keys.set(cardKey(u), (keys.get(cardKey(u)) ?? 0) + 1);
      return ![...keys.values()].some((k) => k >= 2);
    });
    const ruffable = moveSuit !== 'T' && laterSeats.some((o) => opps.includes(o) && canRuff(o, moveSuit));
    f[23] = laterSeats.every((o) => !opps.includes(o)) || (shapeSafe && !ruffable) ? 1 : 0;
  }
  // Pairs broken: one card of an identical pair played, the other kept.
  const inHand = new Map<string, number>();
  for (const c of hand) inHand.set(cardKey(c), (inHand.get(cardKey(c)) ?? 0) + 1);
  const inMove = new Map<string, number>();
  for (const c of move) inMove.set(cardKey(c), (inMove.get(cardKey(c)) ?? 0) + 1);
  let broken = 0;
  for (const [k, cnt] of inMove) if ((inHand.get(k) ?? 0) >= 2 && cnt === 1) broken++;
  f[24] = broken / 2;
  // Boss cards: nothing unseen in the same suit ranks above them.
  f[25] =
    move.filter((c) => !unseenIn(effSuit(c, ctx)).some((u) => cardValue(u, ctx) > cardValue(c, ctx))).length / n;
  f[26] = lead && leadSuit !== 'T' && move.every((c) => isTrump(c, ctx)) ? 1 : 0;
  f[27] = lead ? move.filter((c) => effSuit(c, ctx) !== leadSuit && !isTrump(c, ctx)).length / n : 0;
  f[28] = comps.some((c) => c.kind === 'pair') ? 1 : 0;
  f[29] = comps.some((c) => c.kind === 'tractor') ? 1 : 0;
  f[30] = comps.length > 1 ? 1 : 0;
  if (moveSuit) {
    f[31] = hand.filter((c) => effSuit(c, ctx) === moveSuit).length / 12 / k;
    f[32] = opps.some((o) => canRuff(o, moveSuit)) ? 1 : 0;
    f[33] = canRuff(partner, moveSuit) ? 1 : 0;
    f[34] = unseenIn(moveSuit).filter((u) => cardValue(u, ctx) > Math.max(...values)).length / 10 / k;
  }
  f[35] = [...move.map((c) => c.id)].sort().join(',') === dc.heuristicKey ? 1 : 0;
  // Points this move hands over: to opponents if they're currently winning and we don't take it, to partner if they are.
  if (lead && !wins) {
    if (dc.partnerWinning) f[37] = pts / 40;
    else f[36] = pts / 40;
  }
  // Card counting and score situation.
  f[38] = totalPoints(unseen) / r.points;
  // Only the dealer has seen the kitty — not even their partner.
  f[39] = seat === s.dealer ? totalPoints(s.kitty) / 40 / k : 0;
  // score thresholds sit every `step` points (`win` is a multiple of it): 40, 80, 120, ...
  const nextThreshold = (Math.floor(s.attackerPoints / r.step) + 1) * r.step;
  f[40] = (nextThreshold - s.attackerPoints) / r.step;
  f[41] = (s.attackerPoints - r.win) / (2 * r.step);
  if (moveSuit) {
    f[42] = unseenIn(moveSuit).length / 26 / k;
    f[43] = totalPoints(unseenIn(moveSuit)) / 50 / k;
  }
  f[44] = leadSuit ? unseenIn(leadSuit).length / 26 / k : 0;
  // Triples (3 decks only).
  f[45] = lead && decompose(lead, ctx).some((c) => c.width === 3) ? 1 : 0;
  f[46] = comps.some((c) => c.width === 3) ? 1 : 0;
  let splitTriples = 0;
  for (const [key, cnt] of inMove) if ((inHand.get(key) ?? 0) === 3 && cnt < 3) splitTriples++;
  f[47] = splitTriples / 2;
  return f;
}

