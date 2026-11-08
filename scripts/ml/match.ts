// Duplicate match between two bot configurations: every deal is played twice from the identical position with the
// teams swapped, so card luck cancels and only decisions differ. Bots receive redacted states only.
//   npx tsx scripts/ml/match.ts <A> <B> [deals]   configs: heuristic | search-leads | learned | learned-leads | learned+search-leads
import { writeFileSync } from 'node:fs';
import { botBury, botDeclare, botPlay } from '../../src/game/bot';
import { bury, collectTrick, dealOne, declare, decksOf, finalizeDeclaration, GameState, newGame, play, rulesOf, startRound } from '../../src/game/engine';
import { redactFor } from '../../src/game/info';
import { readFileSync } from 'node:fs';
import { learnedPlay, learnedPlayWith } from '../../src/game/policy';
import { easyMove, liveMove } from '../../src/game/live';
import { READ_PARAMS } from '../../src/game/inference';
import { attackerValue, cashTopCardMove, feedLikelyMove, feedTrickMove, hopelessTrickMove, HOLD_THRESHOLD, keepHighCards, LEVEL_WEIGHT, noRiskyPointLead, noRiskyPointsMove, noUnderlead, priorMove, searchPlay, SEARCH_SAMPLES, settledTrickMove, DEAL_BIAS, searchStats, withDealBias } from '../../src/game/search';

type Policy = (s: GameState, seat: number) => string[];
// a retrained model to compare against the live one: NEW_WEIGHTS=path/to/weights.json
const newPlay = process.env.NEW_WEIGHTS ? learnedPlayWith(JSON.parse(readFileSync(process.env.NEW_WEIGHTS, 'utf8'))) : learnedPlay;
const configs: Record<string, Policy> = {
  'learned-new': newPlay,
  // the retrained model, with the search also scoring playouts by points + levels
  // plus: feed a partner's single-card win when card counting says it very likely holds
  // (tested at 65%: -0.06 ± 1.56 pts, -0.01 ± 0.07 levels per round — neutral; shipped since it fixes visible misses)
  'live-feed': (s, seat) =>
    keepHighCards(s, seat, hopelessTrickMove(s, seat) ?? feedTrickMove(s, seat) ?? feedLikelyMove(s, seat) ?? searchPlay(s, seat, 64, false, learnedPlay(s, seat), LEVEL_WEIGHT)),
  // plus: also cash a side-suit top card when card counting says nobody is likely to trump it
  // (tested at 65%: -0.81 ± 1.57 pts, -0.05 ± 0.07 levels per round vs live — not shipped)
  'live-feed-cash': (s, seat) =>
    keepHighCards(
      s,
      seat,
      hopelessTrickMove(s, seat) ?? feedTrickMove(s, seat) ?? feedLikelyMove(s, seat) ?? cashTopCardMove(s, seat) ??
        searchPlay(s, seat, 64, false, learnedPlay(s, seat), LEVEL_WEIGHT),
    ),
  // live without the "never follow with a higher card than needed" rule (keepHighCards)
  'live-no-keep': (s, seat) =>
    hopelessTrickMove(s, seat) ?? feedTrickMove(s, seat) ?? feedLikelyMove(s, seat) ?? searchPlay(s, seat, 64, false, learnedPlay(s, seat), LEVEL_WEIGHT),
  // live with 4x the sampled deals: how much would a faster search be worth?
  'live-256': (s, seat) =>
    keepHighCards(s, seat, hopelessTrickMove(s, seat) ?? feedTrickMove(s, seat) ?? feedLikelyMove(s, seat) ?? searchPlay(s, seat, 256, false, learnedPlay(s, seat), LEVEL_WEIGHT)),
  // live bots as they run with 3 decks (no keep-high-cards or likely-feeding rules there), and with a retrained model
  live3: (s, seat) => hopelessTrickMove(s, seat) ?? feedTrickMove(s, seat) ?? searchPlay(s, seat, 24, false, learnedPlay(s, seat), LEVEL_WEIGHT),
  'live3-new': (s, seat) => hopelessTrickMove(s, seat) ?? feedTrickMove(s, seat) ?? searchPlay(s, seat, 24, false, newPlay(s, seat), LEVEL_WEIGHT),
  'model3-new': (s, seat) => hopelessTrickMove(s, seat) ?? feedTrickMove(s, seat) ?? newPlay(s, seat),
  model3: (s, seat) => hopelessTrickMove(s, seat) ?? feedTrickMove(s, seat) ?? learnedPlay(s, seat),
  // the same bots without the "no pairs / no triples left" facts when guessing hidden hands
  'live-feed-nofacts': (s, seat) => configs['live-feed']({ ...s, maxCopies: undefined }, seat),
  'live3-nofacts': (s, seat) => configs.live3({ ...s, maxCopies: undefined }, seat),
  // exactly the live bots (src/game/live.ts), with 64 sampled deals per move (24 with 3 decks), and the same reading
  // the other players' recent play (src/game/inference.ts) (READ_TEMP / READ_EPS override the settings)
  live: (s, seat) => liveMove(s, seat, (prior) => searchPlay(s, seat, decksOf(s) === 3 ? 24 : 64, false, prior, LEVEL_WEIGHT)),
  'live-read': (s, seat) =>
    liveMove(s, seat, (prior) => searchPlay(s, seat, decksOf(s) === 3 ? 24 : 64, false, prior, LEVEL_WEIGHT, {
      ...READ_PARAMS,
      ...(process.env.READ_TEMP ? { temp: Number(process.env.READ_TEMP) } : {}),
      ...(process.env.READ_EPS ? { eps: Number(process.env.READ_EPS) } : {}),
    })),
  'live-new': (s, seat) =>
    keepHighCards(s, seat, hopelessTrickMove(s, seat) ?? feedTrickMove(s, seat) ?? feedLikelyMove(s, seat) ?? searchPlay(s, seat, 64, false, newPlay(s, seat), LEVEL_WEIGHT)),
  // The live extra rules with the model in place of the search (fast enough for ~1000-deal tests), and each rule
  // left out in turn, to measure what it's worth.
  // the live chain for this deck count with the model in place of the search, with and without the guard against
  // adding points to a single-card trick our side will probably lose
  // the live pipeline with the model in place of the search, with and without the proven-safe feed
  'live-model': (s, seat) => liveMove(s, seat, (prior) => prior),
  // Easy bots (difficulty setting)
  easy: (s, seat) => easyMove(s, seat),
  'live-model-nofeedsafe': (s, seat) => liveMove(s, seat, (prior) => prior, { feedSafe: false, takeLast: true }),
  'live-model-notakelast': (s, seat) => liveMove(s, seat, (prior) => prior, { feedSafe: true, takeLast: false }),
  // the live pipeline with a short search, with and without taking a point trick when last to play
  'live-s16': (s, seat) => liveMove(s, seat, (prior) => searchPlay(s, seat, 16, false, prior, LEVEL_WEIGHT)),
  'live-s16-notakelast': (s, seat) => liveMove(s, seat, (prior) => searchPlay(s, seat, 16, false, prior, LEVEL_WEIGHT), { feedSafe: true, takeLast: false }),
  'model-live': (s, seat) => modelLive(s, seat, false),
  'model-live-guard': (s, seat) => modelLive(s, seat, true),
  'model-live-guard75': (s, seat) => modelLive(s, seat, true, 0.75),
  'model-live-leadguard': (s, seat) => modelLive(s, seat, true, HOLD_THRESHOLD, true),
  'model-live-nounderlead': (s, seat) => modelLive(s, seat, true, HOLD_THRESHOLD, true, true),
  'model-rules': (s, seat) => keepHighCards(s, seat, hopelessTrickMove(s, seat) ?? feedTrickMove(s, seat) ?? feedLikelyMove(s, seat) ?? learnedPlay(s, seat)),
  'model-rules-no-keep': (s, seat) => hopelessTrickMove(s, seat) ?? feedTrickMove(s, seat) ?? feedLikelyMove(s, seat) ?? learnedPlay(s, seat),
  'model-rules-no-hopeless': (s, seat) => keepHighCards(s, seat, feedTrickMove(s, seat) ?? feedLikelyMove(s, seat) ?? learnedPlay(s, seat)),
  'model-rules-no-feed': (s, seat) => keepHighCards(s, seat, hopelessTrickMove(s, seat) ?? feedLikelyMove(s, seat) ?? learnedPlay(s, seat)),
  'model-rules-no-feed-likely': (s, seat) => keepHighCards(s, seat, hopelessTrickMove(s, seat) ?? feedTrickMove(s, seat) ?? learnedPlay(s, seat)),
  // live bots as they run with 3 decks (at least 16 samples), and the same without any extra rules
  'live-16': (s, seat) =>
    keepHighCards(s, seat, hopelessTrickMove(s, seat) ?? feedTrickMove(s, seat) ?? feedLikelyMove(s, seat) ?? searchPlay(s, seat, 16, false, learnedPlay(s, seat), LEVEL_WEIGHT)),
  'search-16': (s, seat) => searchPlay(s, seat, 16, false, learnedPlay(s, seat), LEVEL_WEIGHT),
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
  // what was live before the points guards: hopeless tricks dump the cheapest cards, partner-won tricks get fed,
  // never a higher card than needed
  'live-old': (s, seat) =>
    keepHighCards(s, seat, hopelessTrickMove(s, seat) ?? feedTrickMove(s, seat) ?? feedLikelyMove(s, seat) ?? searchPlay(s, seat, 64, false, learnedPlay(s, seat), LEVEL_WEIGHT)),
  // plus: when nothing can win the trick and partner isn't winning, dump with the heuristic
  'search+learned+settled+hopeless': (s, seat) =>
    settledTrickMove(s, seat) ?? hopelessTrickMove(s, seat) ?? searchPlay(s, seat, 64, false, learnedPlay(s, seat)),
  // the model's move unless it leaves the trick with the opponents, then the heuristic's; plus the settled-trick rule
  'search+prior+settled': (s, seat) => settledTrickMove(s, seat) ?? searchPlay(s, seat, 64, false, priorMove(s, seat, learnedPlay(s, seat))),
  // alternative: let the search check the heuristic's move instead of the model's
  'search+heuristic+settled': (s, seat) => settledTrickMove(s, seat) ?? searchPlay(s, seat, 64, false, botPlay(s, seat)),
  'learned+search-leads': (s, seat) => (s.trick!.plays.length === 0 ? searchPlay(s, seat, SEARCH_SAMPLES, true) : learnedPlay(s, seat)),
};
function modelLive(s: GameState, seat: number, guard: boolean, bar = HOLD_THRESHOLD, leadGuard = false, noUnder = false): string[] {
  const three = decksOf(s) === 3;
  const learned = learnedPlay(s, seat);
  const move = hopelessTrickMove(s, seat) ?? feedTrickMove(s, seat) ?? (three ? null : feedLikelyMove(s, seat)) ?? (guard ? noRiskyPointsMove(s, seat, leadGuard ? noRiskyPointLead(s, seat, noUnder ? noUnderlead(s, seat, learned) : learned) : learned, bar) : learned);
  return three ? move : keepHighCards(s, seat, move);
}
const [a, b] = [process.argv[2], process.argv[3]];
const deals = Number(process.argv[4] ?? 200);
const rawOut = process.argv[5]; // optional: write per-deal results here for pooling parallel runs
// live-n32, live-read-n64, live-bias-n16...: the live pipeline for this deck count with a fixed number of sampled deals (and reading)
for (const name of [a, b]) {
  // live-es-n96: stops early once settled, after at least 32 deals (16 with 3 decks), as the live bots do
  // live-new-n16: with the retrained model (NEW_WEIGHTS) proposing
  const m = name.match(/^live(-read|-bias|-es|-new)?-n(\d+)$/);
  if (!m) continue;
  const search = (s: GameState, seat: number, prior: string[]) =>
    searchPlay(s, seat, Number(m[2]), false, prior, LEVEL_WEIGHT, m[1] === '-read' ? READ_PARAMS : undefined, m[1] === '-es' ? (decksOf(s) === 3 ? 16 : 32) : undefined);
  const propose = m[1] === '-new' ? newPlay : learnedPlay;
  configs[name] = (s, seat) => liveMove(s, seat, (prior) => (m[1] === '-bias' ? withDealBias(DEAL_BIAS[decksOf(s) === 3 ? 3 : 2], () => search(s, seat, prior)) : search(s, seat, prior)), undefined, propose);
}
if (!configs[a] || !configs[b]) throw new Error(`configs: ${Object.keys(configs).join(', ')}`);
// DECKS=3 plays 3-deck deals
const DECKS = Number(process.env.DECKS ?? 2);
const nm = () => '';
const advs: number[] = [];
const levelAdvs: number[] = []; // level outcome (levels gained, ±0.5 for the deal), same duplicate pairing
const t0 = Date.now();
for (let i = 0; i < deals; i++) {
  const base = newGame(2, DECKS);
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
    return [sign * s.result!.attackerPoints, sign * (attackerValue(s.result!.attackerPoints, 1, rulesOf(s)) - s.result!.attackerPoints)];
  };
  const [r0, r1] = [run(0), run(1)];
  advs.push((r0[0] - r1[0]) / 2);
  levelAdvs.push((r0[1] - r1[1]) / 2);
  if ((i + 1) % 50 === 0) console.error(`  ${i + 1}/${deals} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
if (rawOut) writeFileSync(rawOut, JSON.stringify(advs));
if (rawOut) writeFileSync(rawOut.replace(/\.json$/, '.stats.json'), JSON.stringify(searchStats));
if (rawOut) writeFileSync(rawOut.replace(/\.json$/, '.levels.json'), JSON.stringify(levelAdvs));
const mean = advs.reduce((t, x) => t + x, 0) / deals;
const sd = Math.sqrt(advs.reduce((t, x) => t + (x - mean) ** 2, 0) / (deals - 1));
console.log(
  `${a} vs ${b}, ${deals} duplicate deals: ${mean >= 0 ? '+' : ''}${mean.toFixed(2)} ± ${((1.96 * sd) / Math.sqrt(deals)).toFixed(2)} ` +
    `points/round for ${a}; better on ${advs.filter((x) => x > 0).length}, worse on ${advs.filter((x) => x < 0).length}`,
);
