// Duplicate match between two bot configurations: every deal is played twice from the identical position with the
// teams swapped, so card luck cancels and only decisions differ. Bots receive redacted states only.
//   npx tsx scripts/ml/match.ts <A> <B> [deals]   configs: heuristic | search-leads | learned | learned-leads | learned+search-leads
import { writeFileSync } from 'node:fs';
import { botBury, botDeclare, botPlay } from '../../src/game/bot';
import { bury, collectTrick, dealOne, declare, finalizeDeclaration, GameState, newGame, play, startRound } from '../../src/game/engine';
import { redactFor } from '../../src/game/info';
import { readFileSync } from 'node:fs';
import { learnedPlay, learnedPlayWith } from '../../src/game/policy';
import { attackerValue, feedTrickMove, hopelessTrickMove, keepHighCards, LEVEL_WEIGHT, priorMove, searchPlay, SEARCH_SAMPLES, settledTrickMove } from '../../src/game/search';

type Policy = (s: GameState, seat: number) => string[];
// a retrained model to compare against the live one: NEW_WEIGHTS=path/to/weights.json
const newPlay = process.env.NEW_WEIGHTS ? learnedPlayWith(JSON.parse(readFileSync(process.env.NEW_WEIGHTS, 'utf8'))) : learnedPlay;
const configs: Record<string, Policy> = {
  'learned-new': newPlay,
  // the retrained model, with the search also scoring playouts by points + levels
  'live-new': (s, seat) =>
    keepHighCards(s, seat, hopelessTrickMove(s, seat) ?? feedTrickMove(s, seat) ?? searchPlay(s, seat, 64, false, newPlay(s, seat), LEVEL_WEIGHT)),
  heuristic: botPlay,
  'search-leads': (s, seat) => searchPlay(s, seat, SEARCH_SAMPLES, true),
  learned: learnedPlay,
  'learned-leads': (s, seat) => (s.trick!.plays.length === 0 ? learnedPlay(s, seat) : botPlay(s, seat)),
  // the trained model proposes; a 64-deal search checks every alternative and overrides only on a clear win
  'search+learned': (s, seat) => searchPlay(s, seat, 64, false, learnedPlay(s, seat)),
  // plus: when no opponent plays after us, the trick is settled — take the certain result
  'search+learned+settled': (s, seat) => settledTrickMove(s, seat) ?? searchPlay(s, seat, 64, false, learnedPlay(s, seat)),
  // narrower: only when partner is winning and no opponent plays after us — feed points
  'search+learned+feed': (s, seat) => feedTrickMove(s, seat) ?? searchPlay(s, seat, 64, false, learnedPlay(s, seat)),
  // plus: never follow with a higher card than needed
  'search+learned+feed+keep': (s, seat) => keepHighCards(s, seat, feedTrickMove(s, seat) ?? searchPlay(s, seat, 64, false, learnedPlay(s, seat))),
  // what's live: hopeless tricks dump the cheapest cards, partner-won tricks get fed, never a higher card than needed
  live: (s, seat) =>
    keepHighCards(s, seat, hopelessTrickMove(s, seat) ?? feedTrickMove(s, seat) ?? searchPlay(s, seat, 64, false, learnedPlay(s, seat), LEVEL_WEIGHT)),
  // plus: when nothing can win the trick and partner isn't winning, dump with the heuristic
  'search+learned+settled+hopeless': (s, seat) =>
    settledTrickMove(s, seat) ?? hopelessTrickMove(s, seat) ?? searchPlay(s, seat, 64, false, learnedPlay(s, seat)),
  // the model's move unless it leaves the trick with the opponents, then the heuristic's; plus the settled-trick rule
  'search+prior+settled': (s, seat) => settledTrickMove(s, seat) ?? searchPlay(s, seat, 64, false, priorMove(s, seat, learnedPlay(s, seat))),
  // alternative: let the search check the heuristic's move instead of the model's
  'search+heuristic+settled': (s, seat) => settledTrickMove(s, seat) ?? searchPlay(s, seat, 64, false, botPlay(s, seat)),
  'learned+search-leads': (s, seat) => (s.trick!.plays.length === 0 ? searchPlay(s, seat, SEARCH_SAMPLES, true) : learnedPlay(s, seat)),
};
const [a, b] = [process.argv[2], process.argv[3]];
const deals = Number(process.argv[4] ?? 200);
const rawOut = process.argv[5]; // optional: write per-deal results here for pooling parallel runs
if (!configs[a] || !configs[b]) throw new Error(`configs: ${Object.keys(configs).join(', ')}`);
const nm = () => '';
const advs: number[] = [];
const levelAdvs: number[] = []; // level outcome (levels gained, ±0.5 for the deal), same duplicate pairing
const t0 = Date.now();
for (let i = 0; i < deals; i++) {
  const base = newGame();
  startRound(base);
  while (base.phase === 'dealing') {
    const seat = dealOne(base, 0);
    const o = botDeclare(redactFor(base, seat), seat);
    if (o) declare(base, seat, o.cardIds);
  }
  finalizeDeclaration(base);
  bury(base, base.dealer!, botBury(redactFor(base, base.dealer!), base.dealer!));
  const run = (aTeam: number) => {
    const s: GameState = structuredClone(base);
    while (s.phase === 'playing') {
      const t = s.turn;
      const ids = configs[t % 2 === aTeam ? a : b](redactFor(s, t), t);
      if (play(s, t, ids, nm)) throw new Error('illegal move');
      if (s.trick!.winner !== null) collectTrick(s, nm);
    }
    const sign = s.dealer! % 2 === 0 ? -1 : 1; // team 0's view
    return [sign * s.result!.attackerPoints, sign * (attackerValue(s.result!.attackerPoints, 1) - s.result!.attackerPoints)];
  };
  const [r0, r1] = [run(0), run(1)];
  advs.push((r0[0] - r1[0]) / 2);
  levelAdvs.push((r0[1] - r1[1]) / 2);
  if ((i + 1) % 50 === 0) console.error(`  ${i + 1}/${deals} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
if (rawOut) writeFileSync(rawOut, JSON.stringify(advs));
if (rawOut) writeFileSync(rawOut.replace(/\.json$/, '.levels.json'), JSON.stringify(levelAdvs));
const mean = advs.reduce((t, x) => t + x, 0) / deals;
const sd = Math.sqrt(advs.reduce((t, x) => t + (x - mean) ** 2, 0) / (deals - 1));
console.log(
  `${a} vs ${b}, ${deals} duplicate deals: ${mean >= 0 ? '+' : ''}${mean.toFixed(2)} ± ${((1.96 * sd) / Math.sqrt(deals)).toFixed(2)} ` +
    `points/round for ${a}; better on ${advs.filter((x) => x > 0).length}, worse on ${advs.filter((x) => x < 0).length}`,
);
