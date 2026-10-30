// Bot + randomness evaluation.
//   npx tsx scripts/eval.ts random     statistical tests of the shuffle and deal
//   npx tsx scripts/eval.ts tourney    tournaments between policies (level rate with 95% CI)
//   npx tsx scripts/eval.ts audit      search-based decision audit (regret vs. Monte Carlo search)
import { basicPlay, botBury, botDeclare, botPlay, candidates } from '../src/game/bot';
import { Card, makeDecks, shuffle } from '../src/game/cards';
import {
  bury,
  checkPlay,
  collectTrick,
  ctxOf,
  dealOne,
  declare,
  finalizeDeclaration,
  GameState,
  newGame,
  nextRound,
  play,
  startRound,
} from '../src/game/engine';
import { decompose, effSuit } from '../src/game/rules';
import { cloneState as clone, determinize, moveOptions, rollout as rolloutScore, searchPlay } from '../src/game/search';

const names = (s: number) => `P${s}`;
type Policy = (s: GameState, seat: number) => string[];

// ---------------------------------------------------------------- policies

/** Plays a uniformly random legal move from the bot's candidate set (leads: a random component). */
const randomPolicy: Policy = (s, seat) => {
  const ctx = ctxOf(s);
  const hand = s.hands[seat];
  const trick = s.trick!;
  if (trick.plays.length === 0) {
    const bySuit = new Map<string, Card[]>();
    for (const c of hand) bySuit.set(effSuit(c, ctx), [...(bySuit.get(effSuit(c, ctx)) ?? []), c]);
    const comps = [...bySuit.values()].flatMap((cards) => decompose(cards, ctx));
    return comps[Math.floor(Math.random() * comps.length)].cards.map((c) => c.id);
  }
  const lead = trick.plays[0].cards;
  const legal = candidates(hand, lead, ctx).filter((c) => checkPlay(s, seat, c.map((x) => x.id)) === null);
  return legal[Math.floor(Math.random() * legal.length)].map((c) => c.id);
};

// ---------------------------------------------------------------- game runners

function dealAndSetup(s: GameState) {
  while (s.phase === 'dealing') {
    const seat = dealOne(s, 0);
    const opt = botDeclare(s, seat);
    if (opt) declare(s, seat, opt.cardIds);
  }
  finalizeDeclaration(s);
  bury(s, s.dealer!, botBury(s, s.dealer!));
}

function playOut(s: GameState, policyFor: (seat: number) => Policy) {
  while (s.phase === 'playing') {
    const seat = s.turn;
    const ids = policyFor(seat)(s, seat);
    const err = play(s, seat, ids, names);
    if (err) throw new Error(`illegal move by seat ${seat}: ${err}`);
    if (s.trick!.winner !== null) collectTrick(s, names);
  }
}

/** Plays a full game; team 0 = seats 0/2 use policy A, team 1 = seats 1/3 use B. Returns levels gained per team. */
function playGame(A: Policy, B: Policy): { levels: [number, number]; winner: number } {
  const s = newGame();
  startRound(s);
  const levels: [number, number] = [0, 0];
  for (let guard = 0; guard < 300; guard++) {
    dealAndSetup(s);
    playOut(s, (seat) => (seat % 2 === 0 ? A : B));
    const r = s.result!;
    levels[r.winnerTeam] += r.levelsGained;
    if (s.phase === 'gameOver') return { levels, winner: r.gameWinner! };
    nextRound(s);
  }
  throw new Error('game did not finish');
}

// ---------------------------------------------------------------- statistics helpers

/** Upper-tail p-value of a chi-square statistic (Wilson–Hilferty approximation). */
function chiSqP(x: number, df: number): number {
  const z = (Math.cbrt(x / df) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  return 0.5 * erfc(z / Math.SQRT2);
}
function erfc(x: number): number {
  // Numerical Recipes erfc approximation
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}
function choose(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

// ---------------------------------------------------------------- 1. randomness

function randomnessTests() {
  const N = 200_000;
  const deck = makeDecks(2);
  const idx = new Map(deck.map((c, i) => [c.id, i]));
  const counts = Array.from({ length: 108 }, () => new Float64Array(108));
  for (let n = 0; n < N; n++) {
    const sh = shuffle(deck);
    for (let pos = 0; pos < 108; pos++) counts[idx.get(sh[pos].id)!][pos]++;
  }
  const exp = N / 108;
  let worstP = 1;
  let rejected = 0;
  for (const row of counts) {
    let chi = 0;
    for (const c of row) chi += (c - exp) ** 2 / exp;
    const p = chiSqP(chi, 107);
    worstP = Math.min(worstP, p);
    if (p < 0.01) rejected++;
  }
  console.log(`\nShuffle: ${N.toLocaleString()} shuffles, every card's position tested for uniformity (chi-square, 107 df)`);
  console.log(`  cards failing at p<0.01: ${rejected}/108 (≈1 expected by chance), smallest p = ${worstP.toFixed(4)}`);

  // Deal fairness by seat: jokers and points per hand, and joker-count distribution vs exact hypergeometric.
  const R = 40_000;
  const jokerHist = Array.from({ length: 4 }, () => new Float64Array(5));
  const ptsSum = new Float64Array(4);
  const firstDealer = new Float64Array(4);
  for (let r = 0; r < R; r++) {
    const s = newGame();
    startRound(s);
    while (s.phase === 'dealing') dealOne(s, 0);
    for (let seat = 0; seat < 4; seat++) {
      const h = s.hands[seat];
      jokerHist[seat][h.filter((c) => c.suit === 'J').length]++;
      ptsSum[seat] += h.reduce((t, c) => t + (c.rank === 5 ? 5 : c.rank === 10 || c.rank === 13 ? 10 : 0), 0);
    }
    finalizeDeclaration(s); // nobody declared: tests the random first-round dealer
    firstDealer[s.dealer!]++;
  }
  // P(k jokers in 25 cards from 108 with 4 jokers)
  const hyper = [0, 1, 2, 3, 4].map((k) => (choose(4, k) * choose(104, 25 - k)) / choose(108, 25));
  console.log(`\nDeal: ${R.toLocaleString()} rounds dealt`);
  for (let seat = 0; seat < 4; seat++) {
    let chi = 0;
    for (let k = 0; k < 5; k++) {
      const e = hyper[k] * R;
      if (e > 5) chi += (jokerHist[seat][k] - e) ** 2 / e;
    }
    const meanPts = ptsSum[seat] / R;
    console.log(
      `  seat ${seat}: avg points dealt ${meanPts.toFixed(2)} (expected ${((200 * 25) / 108).toFixed(2)}), joker distribution vs exact odds p = ${chiSqP(chi, 3).toFixed(3)}`,
    );
  }
  const fdChi = [...firstDealer].reduce((t, c) => t + (c - R / 4) ** 2 / (R / 4), 0);
  console.log(`  first-round dealer when nobody declares: ${[...firstDealer].map((c) => pct(c / R)).join(' / ')}  (uniform test p = ${chiSqP(fdChi, 3).toFixed(3)})`);
}

// ---------------------------------------------------------------- 2. tournaments

function tournament(label: string, A: Policy, B: Policy, games: number) {
  // Half the games with A on team 0, half with A on team 1, to cancel any seat/team advantage.
  const perGame: number[] = [];
  let aLevels = 0;
  let bLevels = 0;
  let aWins = 0;
  for (let g = 0; g < games; g++) {
    const swap = g % 2 === 1;
    const r = swap ? playGame(B, A) : playGame(A, B);
    const a = swap ? r.levels[1] : r.levels[0];
    const b = swap ? r.levels[0] : r.levels[1];
    aLevels += a;
    bLevels += b;
    perGame.push(a / Math.max(1, a + b));
    if ((r.winner === 0) !== swap) aWins++;
  }
  const mean = perGame.reduce((t, x) => t + x, 0) / games;
  const sd = Math.sqrt(perGame.reduce((t, x) => t + (x - mean) ** 2, 0) / (games - 1));
  const ci = (1.96 * sd) / Math.sqrt(games);
  console.log(
    `  ${label.padEnd(34)} games won ${aWins}/${games} (${pct(aWins / games)})   level rate ${pct(aLevels / (aLevels + bLevels))} ± ${pct(ci)}`,
  );
}

// ---------------------------------------------------------------- 3. search audit

function audit(decisions: number, samples: number) {
  console.log(`\nSearch audit: ${decisions} decisions, each option played out on ${samples} hidden-card deals (half to pick the best option, half to measure the bot's loss)`);
  const rows: { lead: boolean; regret: number; best: boolean; options: number; se: number }[] = [];
  const t0 = Date.now();
  while (rows.length < decisions) {
    const s = newGame();
    startRound(s);
    dealAndSetup(s);
    while (s.phase === 'playing' && rows.length < decisions) {
      const seat = s.turn;
      if (Math.random() < 0.12 && s.hands[seat].length > 1) {
        const options = moveOptions(s, seat);
        if (options.length > 1) {
          // Pick the best option on one half of the deals, then measure the bot's loss on the other half,
          // so the noise that makes some option look best doesn't inflate the measured loss.
          const deals = Array.from({ length: samples }, () => determinize(s, seat));
          const half = Math.floor(samples / 2);
          const scores = options.map((m) => deals.map((d) => rolloutScore(clone(d), seat, m)));
          const meanOf = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / xs.length;
          const selMeans = scores.map((xs) => meanOf(xs.slice(0, half)));
          const bestIdx = selMeans.indexOf(Math.max(...selMeans));
          const diffs = scores[bestIdx].slice(half).map((x, i) => x - scores[0][half + i]); // option 0 is the bot's move
          const regret = meanOf(diffs);
          const sdv = Math.sqrt(diffs.reduce((t, x) => t + (x - regret) ** 2, 0) / Math.max(1, diffs.length - 1));
          const n2 = diffs.length;
          rows.push({ lead: s.trick!.plays.length === 0, regret, best: bestIdx === 0, options: options.length, se: sdv / Math.sqrt(n2) });
          if (rows.length % 25 === 0) process.stdout.write(`  ...${rows.length} decisions (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
        }
      }
      const ids = botPlay(s, seat);
      play(s, seat, ids, names);
      if (s.trick!.winner !== null) collectTrick(s, names);
    }
  }
  const summarize = (label: string, rs: typeof rows) => {
    if (!rs.length) return;
    const mean = rs.reduce((t, r) => t + r.regret, 0) / rs.length;
    const sig = rs.filter((r) => r.regret > 2 * r.se && r.regret >= 5).length;
    console.log(
      `  ${label.padEnd(8)} n=${String(rs.length).padStart(3)}  avg options ${(rs.reduce((t, r) => t + r.options, 0) / rs.length).toFixed(1)}  ` +
        `bot's move = search's best ${pct(rs.filter((r) => r.best).length / rs.length)}  ` +
        `avg points lost ${mean.toFixed(2)}  clearly-worse moves (≥5 pts, >2 SE) ${pct(sig / rs.length)}`,
    );
  };
  summarize('all', rows);
  summarize('leads', rows.filter((r) => r.lead));
  summarize('follows', rows.filter((r) => !r.lead));
}

// ---------------------------------------------------------------- 4. search bot vs heuristic bot

function headToHead(rounds: number, samples: number) {
  const search: Policy = (s, seat) => searchPlay(s, seat, samples);
  let searchLevels = 0;
  let heurLevels = 0;
  let edge = 0; // attacker points swing in the search team's favour
  let played = 0;
  const perRound: number[] = [];
  const t0 = Date.now();
  while (played < rounds) {
    const searchTeam = Math.floor(played / 10) % 2; // switch sides every 10 rounds
    const s = newGame();
    startRound(s);
    for (let r = 0; r < 10 && played < rounds; r++) {
      dealAndSetup(s);
      playOut(s, (seat) => (seat % 2 === searchTeam ? search : botPlay));
      const res = s.result!;
      const searchAttacking = s.dealer! % 2 !== searchTeam;
      const swing = searchAttacking ? res.attackerPoints : -res.attackerPoints;
      edge += swing;
      perRound.push(swing);
      if (res.winnerTeam === searchTeam) searchLevels += res.levelsGained;
      else heurLevels += res.levelsGained;
      played++;
      if (played % 20 === 0) process.stdout.write(`  ...${played} rounds (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
      if (s.phase === 'gameOver') break;
      nextRound(s);
    }
  }
  // Compare against the same rounds' expected 0 swing: mean attacker-point swing with 95% CI
  const mean = edge / rounds;
  const sd = Math.sqrt(perRound.reduce((t, x) => t + (x - mean) ** 2, 0) / (rounds - 1));
  console.log(`\nSearch bot (${samples} deals/move) vs heuristic bot over ${rounds} rounds, sides swapped every 10:`);
  console.log(`  levels won: search ${searchLevels}, heuristic ${heurLevels}  →  search level rate ${pct(searchLevels / Math.max(1, searchLevels + heurLevels))}`);
  console.log(`  points swing per round in search's favour: ${mean >= 0 ? '+' : ''}${mean.toFixed(1)} ± ${((1.96 * sd) / Math.sqrt(rounds)).toFixed(1)}`);
  console.log(`  avg time per round: ${((Date.now() - t0) / rounds / 1000).toFixed(2)}s`);
}

// ---------------------------------------------------------------- 5. duplicate match (luck cancelled)

/**
 * Each deal is played twice from the identical starting position (same cards, trump, dealer, kitty): once with
 * the search bot on team 0 and once on team 1. The difference in team 0's result between the two runs is down to
 * the bots' decisions alone, so the luck of the deal cancels out.
 */
function duplicate(deals: number, samples: number, leadsOnly: boolean) {
  const search: Policy = (s, seat) => searchPlay(s, seat, samples, leadsOnly);
  const advs: number[] = [];
  const t0 = Date.now();
  const value = (s: GameState) => (s.dealer! % 2 === 0 ? -1 : 1) * s.result!.attackerPoints; // team 0's view
  for (let i = 0; i < deals; i++) {
    const base = newGame();
    startRound(base);
    dealAndSetup(base);
    const a = clone(base);
    playOut(a, (seat) => (seat % 2 === 0 ? search : botPlay));
    const b = clone(base);
    playOut(b, (seat) => (seat % 2 === 1 ? search : botPlay));
    advs.push((value(a) - value(b)) / 2); // per-side advantage of search over heuristic
    if ((i + 1) % 25 === 0) process.stdout.write(`  ...${i + 1} deals (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
  }
  const mean = advs.reduce((t, x) => t + x, 0) / deals;
  const sd = Math.sqrt(advs.reduce((t, x) => t + (x - mean) ** 2, 0) / (deals - 1));
  const better = advs.filter((x) => x > 0).length;
  const worse = advs.filter((x) => x < 0).length;
  console.log(`\nDuplicate match, ${deals} deals × 2 (search ${leadsOnly ? 'on leads only' : 'on every move'}, ${samples} deals/move):`);
  console.log(`  search advantage: ${mean >= 0 ? '+' : ''}${mean.toFixed(2)} ± ${((1.96 * sd) / Math.sqrt(deals)).toFixed(2)} points per round (95% CI)`);
  console.log(`  deals where search did better / worse / same: ${better} / ${worse} / ${deals - better - worse}`);
}

// ---------------------------------------------------------------- main

const mode = process.argv[2] ?? 'all';
if (mode === 'random' || mode === 'all') randomnessTests();
if (mode === 'tourney' || mode === 'all') {
  const n = Number(process.argv[3] ?? 200);
  console.log(`\nTournaments (${n} full games each, seats swapped every other game):`);
  tournament('strong bot vs random legal play', botPlay, randomPolicy, n);
  tournament('strong bot vs simple baseline', botPlay, basicPlay, n);
  tournament('strong bot vs strong bot', botPlay, botPlay, n);
}
if (mode === 'audit' || mode === 'all') audit(Number(process.argv[3] ?? 200), Number(process.argv[4] ?? 24));
if (mode === 'dup') duplicate(Number(process.argv[3] ?? 150), Number(process.argv[4] ?? 48), process.argv[5] !== 'all');
if (mode === 'h2h') headToHead(Number(process.argv[3] ?? 200), Number(process.argv[4] ?? 16));
