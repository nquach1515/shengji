/*
 * What each seat is allowed to know.
 *
 * Bots (and the hint helper) are only ever handed a redacted copy of the game: other players' hands and the
 * face-down kitty are replaced by blank placeholder cards, so no bot code can read hidden cards even by accident.
 * Hand sizes stay visible, as they are at a real table.
 */
import { Card } from './cards';
import { GameState, NUM_PLAYERS } from './engine';

const hidden = (tag: string, i: number): Card => ({ id: `hidden-${tag}-${i}`, suit: 'J', rank: 0 });

export function redactFor(s: GameState, seat: number): GameState {
  const r = structuredClone(s);
  for (let o = 0; o < NUM_PLAYERS; o++) {
    if (o !== seat) r.hands[o] = s.hands[o].map((_, i) => hidden(`p${o}`, i));
  }
  // The kitty is face down; only the dealer (after picking it up and burying) knows what's in it.
  const dealerKnowsKitty = seat === s.dealer && s.phase !== 'dealing' && s.phase !== 'declaring';
  if (!dealerKnowsKitty) r.kitty = s.kitty.map((_, i) => hidden('kitty', i));
  r.deck = s.deck.map((_, i) => hidden('deck', i));
  return r;
}

/**
 * Cards whose location `seat` can legitimately infer from what's been shown publicly this round:
 *  - cards a player revealed to declare trump are in their hand until played (unless they're the dealer, who
 *    may have buried them);
 *  - cards a player had to take back from a blocked throw are in their hand until played.
 */
export function knownLocations(s: GameState, seat: number): Map<string, number> {
  const pins = new Map<string, number>();
  const played = new Set(s.played.map((c) => c.id));
  const d = s.declaration;
  if (d && d.seat !== seat && d.seat !== s.dealer) {
    for (const c of d.cards) if (!played.has(c.id)) pins.set(c.id, d.seat);
  }
  for (const e of s.events) {
    if (e.kind === 'throwFail' && e.round === s.round && e.seat !== undefined && e.seat !== seat && e.cards) {
      for (const c of e.cards) if (!played.has(c.id)) pins.set(c.id, e.seat);
    }
  }
  return pins;
}
