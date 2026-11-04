/// <reference lib="webworker" />
// Runs bot thinking off the main thread so the host's animations stay smooth.
// It only ever receives a redacted state (other hands and the face-down kitty blanked out).
//
// Each move: the trained model (src/game/policy.ts) proposes, then a time-budgeted Monte Carlo search checks every
// alternative and overrides only on a clear win. In a 240-deal duplicate match this beat the model alone by
// +8.8 +/- 1.8 points per round. Playouts are scored by points plus the level outcome (LEVEL_WEIGHT), so crossing a
// score threshold counts for more than a point either side of it.
import { decksOf, GameState } from './engine';
import { learnedPlay } from './policy';
import { feedLikelyMove, feedTrickMove, hopelessTrickMove, keepHighCards, LEVEL_WEIGHT, noRiskyPointLead, noRiskyPointsMove, noUnderlead, searchPlayTimed } from './search';

self.onmessage = (e: MessageEvent<{ id: number; state: GameState; seat: number; budgetMs: number }>) => {
  const { id, state, seat, budgetMs } = e.data;
  let ids: string[] | null = null;
  const three = decksOf(state) === 3;
  // 3-deck playouts are longer, so fewer guaranteed samples keep the slowest moves as quick as with 2 decks
  const minSamples = three ? 16 : 32;
  try {
    const move =
      hopelessTrickMove(state, seat) ??
      feedTrickMove(state, seat) ??
      // 3 decks, 3,000 duplicate deals each (scripts/ml/match.ts): feeding a likely-winning partner cost
      // -0.71 ± 0.34 points/round and never-higher-than-needed -0.71 ± 0.37, so neither is used there
      (three ? null : feedLikelyMove(state, seat)) ??
      // no points into a single-card trick our side will probably lose, no leading a point card that can be beaten,
      // and no underleading a side suit's top card (neutral in 2,000-deal matches, and it looks like a gift)
      noRiskyPointLead(state, seat, noUnderlead(state, seat, noRiskyPointsMove(state, seat, searchPlayTimed(state, seat, budgetMs, learnedPlay(state, seat), minSamples, 400, LEVEL_WEIGHT))));
    ids = three ? move : keepHighCards(state, seat, move);
  } catch {
    ids = null;
  }
  (self as unknown as Worker).postMessage({ id, ids });
};
