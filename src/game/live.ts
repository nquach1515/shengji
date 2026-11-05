/*
 * The live bots' (and Hint's) move, shared by the bot worker and the test scripts so tests play exactly what's live.
 * `search` checks the model's proposal with Monte Carlo playouts (time-budgeted live, a fixed sample count in tests).
 */
import { botPlay } from './bot';
import { decksOf, GameState } from './engine';
import { learnedPlay } from './policy';
import { feedLikelyMove, feedSafeMove, feedTrickMove, takeLastTrickMove, hopelessTrickMove, keepHighCards, noRiskyPointLead, noRiskyPointsMove, noUnderlead, moveOptions } from './search';

export function liveMove(state: GameState, seat: number, search: (prior: string[]) => string[], opts = { feedSafe: true, takeLast: true }): string[] {
  const three = decksOf(state) === 3;
  const move =
    hopelessTrickMove(state, seat) ??
    feedTrickMove(state, seat) ??
    // last to play and able to take the opponents' points: a certain gain, no simulation needed
    (opts.takeLast ? takeLastTrickMove(state, seat) : null) ??
    // partner's winning cards can't be beaten by anyone still to play: feed points. 2 decks only: 4,000 duplicate
    // deals with 3 decks measured -0.26 ± 0.20 points/round (2 decks, 2,000 deals: +0.04 ± 0.18)
    (opts.feedSafe && !three ? feedSafeMove(state, seat) : null) ??
    // 3 decks, 3,000 duplicate deals each (scripts/ml/match.ts): feeding a likely-winning partner cost
    // -0.71 ± 0.34 points/round and never-higher-than-needed -0.71 ± 0.37, so neither is used there
    (three ? null : feedLikelyMove(state, seat)) ??
    // no points into a single-card trick our side will probably lose, no leading a point card that can be beaten,
    // and no underleading a side suit's top card (neutral in 2,000-deal matches, and it looks like a gift)
    noRiskyPointLead(state, seat, noUnderlead(state, seat, noRiskyPointsMove(state, seat, search(learnedPlay(state, seat)))));
  return three ? move : keepHighCards(state, seat, move);
}

export type Difficulty = 'easy' | 'normal' | 'hard';

/** How often an Easy bot plays a random sensible move instead of the rule-based bot's. */
export const EASY_SLIP = 0.25;

/** Easy bots: the rule-based bot, slipping to a random sensible move some of the time. */
export function easyMove(state: GameState, seat: number, rng: () => number = Math.random): string[] {
  if (rng() < EASY_SLIP) {
    const options = moveOptions(state, seat);
    return options[Math.floor(rng() * options.length)];
  }
  return botPlay(state, seat);
}
