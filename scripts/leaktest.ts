// Information-leak test: a bot's decisions may depend only on what its seat can know.
// At many real positions we compare the bot's choice on (a) the real game, (b) the redacted copy bots receive, and
// (c) an alternate world where everyone else's hidden cards are re-dealt at random — consistent with everything public
// (cards played, hand sizes, revealed voids, cards shown when declaring). Any difference means hidden cards leaked.
//   npx tsx scripts/leaktest.ts [games]
import { botBury, botDeclare, botPlay } from '../src/game/bot';
import { bury, collectTrick, dealOne, declare, finalizeDeclaration, GameState, newGame, play, startRound } from '../src/game/engine';
import { decisionContext, moveFeatures } from '../src/game/features';
import { redactFor } from '../src/game/info';
import { determinize, moveOptions, searchBury, searchPlay } from '../src/game/search';
import { READ_PARAMS } from '../src/game/inference';
import { learnedPlay } from '../src/game/policy';

const nm = () => '';
const games = Number(process.argv[2] ?? 40);
const decks = Number(process.argv[3] ?? 2);
const same = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();
const checks = { plays: 0, learned: 0, bury: 0, buryPlans: 0, declare: 0, features: 0, search: 0 };
const leaks: string[] = [];

/** Another possible world: same public information, hidden cards re-dealt (seat's own hand untouched). */
function alternateWorld(s: GameState, seat: number): GameState {
  return determinize(redactFor(s, seat), seat);
}

for (let g = 0; g < games; g++) {
  const s = newGame(2, decks);
  startRound(s);
  while (s.phase === 'dealing') {
    const seat = dealOne(s, 0);
    const real = botDeclare(s, seat)?.cardIds ?? [];
    const red = botDeclare(redactFor(s, seat), seat)?.cardIds ?? [];
    checks.declare++;
    if (!same(real, red)) leaks.push(`declare differs for seat ${seat}`);
    if (real.length) declare(s, seat, real);
  }
  finalizeDeclaration(s);
  const dealer = s.dealer!;
  const buryReal = botBury(s, dealer);
  checks.bury++;
  if (!same(buryReal, botBury(redactFor(s, dealer), dealer))) leaks.push('bury differs on redacted state');
  // the bury search (Hard bots) must run on the redacted state alone and give a legal burial
  if (Math.random() < 0.25) {
    checks.buryPlans++;
    const searched = searchBury(redactFor(s, dealer), dealer, 4);
    const test = structuredClone(s);
    if (bury(test, dealer, searched)) leaks.push('bury search gave an illegal burial on redacted state');
  }
  bury(s, dealer, buryReal);
  while (s.phase === 'playing') {
    const seat = s.turn;
    const real = botPlay(s, seat);
    const red = botPlay(redactFor(s, seat), seat);
    const alt = alternateWorld(s, seat);
    const altMove = botPlay(alt, seat);
    checks.plays++;
    if (!same(real, red)) leaks.push(`move differs on redacted state (round trick ${s.tricksPlayed})`);
    if (!same(real, altMove)) leaks.push(`move differs when hidden cards are re-dealt (trick ${s.tricksPlayed})`);
    // The learned model too.
    checks.learned++;
    if (!same(learnedPlay(s, seat), learnedPlay(alt, seat)) || !same(learnedPlay(s, seat), learnedPlay(redactFor(s, seat), seat)))
      leaks.push(`learned model's move depends on hidden cards (trick ${s.tricksPlayed})`);
    // Model features for every option must not depend on hidden cards either.
    const opts = moveOptions(s, seat);
    const dcReal = decisionContext(s, seat, opts[0]);
    const dcAlt = decisionContext(alt, seat, opts[0]);
    for (const m of opts) {
      const cards = s.hands[seat].filter((c) => m.includes(c.id));
      checks.features++;
      if (moveFeatures(dcReal, cards).join() !== moveFeatures(dcAlt, cards).join()) leaks.push('features differ when hidden cards are re-dealt');
    }
    // The search must run on the redacted state alone (it errors if it needed real hidden cards).
    if (Math.random() < 0.05) {
      checks.search++;
      const m = searchPlay(redactFor(s, seat), seat, 8);
      if (!m.length) leaks.push('search failed on redacted state');
      // reading the other players' play must also work from the redacted state alone
      const r = searchPlay(redactFor(s, seat), seat, 8, false, undefined, 0, READ_PARAMS);
      if (!r.length) leaks.push('search with play reading failed on redacted state');
    }
    play(s, seat, real, nm);
    if (s.trick!.winner !== null) collectTrick(s, nm);
  }
}
console.log(
  `checked ${checks.plays} heuristic + ${checks.learned} learned-model moves (each vs. redacted and re-dealt worlds), ${checks.features} move-feature vectors, ` +
    `${checks.bury} burials (${checks.buryPlans} searched), ${checks.declare} declaration decisions, ${checks.search} searches on redacted state`,
);
if (leaks.length) {
  console.log(`LEAKS FOUND: ${leaks.length}`);
  for (const l of [...new Set(leaks)].slice(0, 10)) console.log('  ' + l);
  process.exit(1);
}
console.log('no information leaks: every decision is identical whatever the hidden cards are');
