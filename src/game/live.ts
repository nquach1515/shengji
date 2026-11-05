/*
 * The live bots' (and Hint's) move, shared by the bot worker and the test scripts so tests play exactly what's live.
 * `search` checks the model's proposal with Monte Carlo playouts (time-budgeted live, a fixed sample count in tests).
 */
import { decksOf, GameState } from './engine';
import { learnedPlay } from './policy';
import { feedLikelyMove, feedTrickMove, hopelessTrickMove, keepHighCards, noRiskyPointLead, noRiskyPointsMove, noUnderlead } from './search';

export function liveMove(state: GameState, seat: number, search: (prior: string[]) => string[]): string[] {
  const three = decksOf(state) === 3;
  const move =
    hopelessTrickMove(state, seat) ??
    feedTrickMove(state, seat) ??
    // 3 decks, 3,000 duplicate deals each (scripts/ml/match.ts): feeding a likely-winning partner cost
    // -0.71 ± 0.34 points/round and never-higher-than-needed -0.71 ± 0.37, so neither is used there
    (three ? null : feedLikelyMove(state, seat)) ??
    // no points into a single-card trick our side will probably lose, no leading a point card that can be beaten,
    // and no underleading a side suit's top card (neutral in 2,000-deal matches, and it looks like a gift)
    noRiskyPointLead(state, seat, noUnderlead(state, seat, noRiskyPointsMove(state, seat, search(learnedPlay(state, seat)))));
  return three ? move : keepHighCards(state, seat, move);
}
