/// <reference lib="webworker" />
// Runs bot thinking off the main thread so the host's animations stay smooth.
// It only ever receives a redacted state (other hands and the face-down kitty blanked out).
//
// Each move: the trained model (src/game/policy.ts) proposes, then a time-budgeted Monte Carlo search checks every
// alternative and overrides only on a clear win. In a 240-deal duplicate match this beat the model alone by
// +8.8 +/- 1.8 points per round. Playouts are scored by points plus the level outcome (LEVEL_WEIGHT), so crossing a
// score threshold counts for more than a point either side of it.
import { GameState } from './engine';
import { learnedPlay } from './policy';
import { feedTrickMove, hopelessTrickMove, keepHighCards, LEVEL_WEIGHT, searchPlayTimed } from './search';

self.onmessage = (e: MessageEvent<{ id: number; state: GameState; seat: number; budgetMs: number }>) => {
  const { id, state, seat, budgetMs } = e.data;
  let ids: string[] | null = null;
  try {
    ids = keepHighCards(state, seat, hopelessTrickMove(state, seat) ?? feedTrickMove(state, seat) ?? searchPlayTimed(state, seat, budgetMs, learnedPlay(state, seat), 32, 400, LEVEL_WEIGHT));
  } catch {
    ids = null;
  }
  (self as unknown as Worker).postMessage({ id, ids });
};
