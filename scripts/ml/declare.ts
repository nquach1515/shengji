// Tunes when bots declare trump.
// Each deal is shuffled once and dealt twice with the teams swapped: one team declares with settings A, the other
// with B, and the rest of the round is played out by the same bots. Card luck cancels; only declaring differs.
// Rounds use a predetermined dealer (the normal case after round 1), so declaring decides the trump suit.
//   npx tsx scripts/ml/declare.ts search <candidates> <deals> <seed> <out.json>
//   npx tsx scripts/ml/declare.ts confirm <deals> <out.json> '<params-json>'...
// DECKS=3 tunes the 3-deck settings (DECLARE_PARAMS_3), keeping their minDealt.
import { writeFileSync } from 'node:fs';
import { botBury, botDeclare, botPlay, declareParamsFor, DeclareParams } from '../../src/game/bot';
import { bury, collectTrick, dealOne, declare, finalizeDeclaration, GameState, newGame, play, startRound } from '../../src/game/engine';
import { redactFor } from '../../src/game/info';

const nm = () => '';
const DECKS = Number(process.env.DECKS ?? 2);
const DECLARE_PARAMS = declareParamsFor(DECKS);

/** Value of one dealt-and-played round from team 0's view (attacker points, signed). */
function runRound(base: GameState, team0: DeclareParams, team1: DeclareParams): number {
  const s: GameState = structuredClone(base);
  const params = (seat: number) => (seat % 2 === 0 ? team0 : team1);
  while (s.phase === 'dealing') {
    const seat = dealOne(s, 0);
    const o = botDeclare(redactFor(s, seat), seat, params(seat));
    if (o) declare(s, seat, o.cardIds);
  }
  // Last-chance window: each bot (starting after the dealer) may declare once with its full hand.
  for (let i = 0; i < 4; i++) {
    const seat = (s.dealer! + i) % 4;
    const o = botDeclare(redactFor(s, seat), seat, params(seat));
    if (o) declare(s, seat, o.cardIds);
  }
  finalizeDeclaration(s);
  bury(s, s.dealer!, botBury(redactFor(s, s.dealer!), s.dealer!));
  while (s.phase === 'playing') {
    const t = s.turn;
    play(s, t, botPlay(redactFor(s, t), t), nm);
    if (s.trick!.winner !== null) collectTrick(s, nm);
  }
  return (s.dealer! % 2 === 0 ? -1 : 1) * s.result!.attackerPoints;
}

function duplicate(a: DeclareParams, b: DeclareParams, deals: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < deals; i++) {
    const base = newGame(2, DECKS);
    base.dealer = Math.floor(Math.random() * 4);
    startRound(base);
    // per-side advantage of settings A over B
    out.push((runRound(base, a, b) - runRound(base, b, a)) / 2);
  }
  return out;
}

const stats = (xs: number[]) => {
  const n = xs.length;
  const m = xs.reduce((t, x) => t + x, 0) / n;
  const sd = Math.sqrt(xs.reduce((t, x) => t + (x - m) ** 2, 0) / (n - 1));
  return { mean: m, ci: (1.96 * sd) / Math.sqrt(n), n };
};

function randomParams(rng: () => number): DeclareParams {
  const u = (lo: number, hi: number) => lo + (hi - lo) * rng();
  return {
    minDealt: DECKS === 3 ? DECLARE_PARAMS.minDealt : 10 + Math.floor(rng() * 11), // 10..20: don't declare absurdly early
    thNone: +u(0.25, 0.5).toFixed(3),
    thOpp: +u(0.3, 0.6).toFixed(3),
    thPartner: +u(0.5, 1.5).toFixed(3), // ≥1 means never override partner
    pairBonus: +u(0, 0.15).toFixed(3),
    jokerWeight: +u(0.8, 2.2).toFixed(2),
    late: rng() < 0.6,
    lateTh: +u(0.25, 0.5).toFixed(3),
    ...(DECKS === 3 ? { tripleBonus: +u(0, 0.15).toFixed(3) } : {}),
  };
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
    results.push({ params: p, ...stats(duplicate(p, DECLARE_PARAMS, deals)) });
  }
  writeFileSync(out, JSON.stringify(results));
} else if (mode === 'confirm') {
  const deals = Number(process.argv[3]);
  const out = process.argv[4];
  const results = process.argv.slice(5).map((js) => {
    const p = { ...DECLARE_PARAMS, ...JSON.parse(js) } as DeclareParams;
    return { params: p, ...stats(duplicate(p, DECLARE_PARAMS, deals)) };
  });
  writeFileSync(out, JSON.stringify(results));
}
