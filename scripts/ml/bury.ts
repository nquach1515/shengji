// Tunes what the dealer buries.
// Each deal is dealt and declared once; then the dealer buries with settings A, or with B, and the round is played
// out by the same bots (the model plus the live rules, no search) both times. Only the burial differs.
// Scored from the dealer's team's view: points kept from the attackers, plus LEVEL_WEIGHT per level (as the search).
//   npx tsx scripts/ml/bury.ts search <candidates> <deals> <seed> <out.json>
//   npx tsx scripts/ml/bury.ts confirm <deals> <out.json> '<params-json>'...
//   npx tsx scripts/ml/bury.ts versus <deals> <out.json>     (searchBury vs the formula; BURY_SAMPLES sets its deals)
// DECKS=3 plays 3-deck deals.
import { writeFileSync } from 'node:fs';
import { botBury, botDeclare, buryParamsFor, BuryParams } from '../../src/game/bot';
import { bury, collectTrick, dealOne, declare, decksOf, finalizeDeclaration, GameState, newGame, play, rulesOf, startRound } from '../../src/game/engine';
import { redactFor } from '../../src/game/info';
import { learnedPlay } from '../../src/game/policy';
import { attackerValue, feedLikelyMove, feedTrickMove, hopelessTrickMove, keepHighCards, LEVEL_WEIGHT, searchBury } from '../../src/game/search';

const nm = () => '';
const DECKS = Number(process.env.DECKS ?? 2);
const BURY_PARAMS = buryParamsFor(DECKS);
const SEARCH_N = Number(process.env.BURY_SAMPLES ?? 24);

function move(s: GameState, seat: number): string[] {
  if (decksOf(s) === 3) return hopelessTrickMove(s, seat) ?? feedTrickMove(s, seat) ?? learnedPlay(s, seat);
  return keepHighCards(s, seat, hopelessTrickMove(s, seat) ?? feedTrickMove(s, seat) ?? feedLikelyMove(s, seat) ?? learnedPlay(s, seat));
}

/** [points, value] from the dealer's team's view. */
function runRound(base: GameState, p: BuryParams | 'search'): [number, number] {
  const s: GameState = structuredClone(base);
  const view = redactFor(s, s.dealer!);
  bury(s, s.dealer!, p === 'search' ? searchBury(view, s.dealer!, SEARCH_N) : botBury(view, s.dealer!, p));
  while (s.phase === 'playing') {
    const t = s.turn;
    play(s, t, move(redactFor(s, t), t), nm);
    if (s.trick!.winner !== null) collectTrick(s, nm);
  }
  const pts = s.result!.attackerPoints;
  return [-pts, -attackerValue(pts, LEVEL_WEIGHT, rulesOf(s))];
}

function duplicate(a: BuryParams | 'search', b: BuryParams, deals: number) {
  const pts: number[] = [];
  const val: number[] = [];
  for (let i = 0; i < deals; i++) {
    const base = newGame(2, DECKS);
    startRound(base);
    while (base.phase === 'dealing') {
      const seat = dealOne(base, 0);
      const o = botDeclare(redactFor(base, seat), seat);
      if (o) declare(base, seat, o.cardIds);
    }
    finalizeDeclaration(base);
    const [ra, rb] = [runRound(base, a), runRound(base, b)];
    pts.push(ra[0] - rb[0]);
    val.push(ra[1] - rb[1]);
  }
  return { points: stats(pts), value: stats(val) };
}

const stats = (xs: number[]) => {
  const n = xs.length;
  const m = xs.reduce((t, x) => t + x, 0) / n;
  const sd = Math.sqrt(xs.reduce((t, x) => t + (x - m) ** 2, 0) / (n - 1));
  return { mean: +m.toFixed(3), ci: +((1.96 * sd) / Math.sqrt(n)).toFixed(3), n };
};

function randomParams(rng: () => number): BuryParams {
  const u = (lo: number, hi: number) => +(lo + (hi - lo) * rng()).toFixed(1);
  return { len: u(0, 15), value: u(0, 6), points: u(0, 15), pair: u(0, 120), triple: u(0, 120), ace: u(0, 120) };
}

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mode = process.argv[2];
if (mode === 'search') {
  const [cands, deals, seed, out] = [Number(process.argv[3]), Number(process.argv[4]), Number(process.argv[5]), process.argv[6]];
  const rng = mulberry(seed);
  const results = [];
  for (let i = 0; i < cands; i++) {
    const p = randomParams(rng);
    results.push({ params: p, ...duplicate(p, BURY_PARAMS, deals) });
    writeFileSync(out, JSON.stringify(results));
  }
} else if (mode === 'confirm') {
  const deals = Number(process.argv[3]);
  const out = process.argv[4];
  const results = process.argv.slice(5).map((js) => {
    const p = { ...BURY_PARAMS, ...JSON.parse(js) } as BuryParams;
    return { params: p, ...duplicate(p, BURY_PARAMS, deals) };
  });
  writeFileSync(out, JSON.stringify(results));
} else if (mode === 'versus') {
  const [deals, out] = [Number(process.argv[3]), process.argv[4]];
  writeFileSync(out, JSON.stringify(duplicate('search', BURY_PARAMS, deals)));
}
