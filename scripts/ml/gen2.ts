// Training data, rounds 2+ (expert iteration): self-play games are played by the current trained model (with some
// exploration), and every sensible option is scored by Monte Carlo search whose playouts also use the trained model
// — a stronger teacher than round 1, whose games and playouts used the heuristic bot. One JSON line per decision.
// Playouts are scored by points plus a bonus for the level outcome (LEVEL_WEIGHT points per level and for taking or
// keeping the deal), so crossing 40/80/120 matters more than a point either side of it. LEVEL_WEIGHT=0 → raw points.
//   npx tsx scripts/ml/gen2.ts <decisions> <deals-per-option> <out.jsonl>
import { appendFileSync, writeFileSync } from 'node:fs';
import { botBury, botDeclare, botPlay } from '../../src/game/bot';
import { bury, collectTrick, dealOne, declare, finalizeDeclaration, GameState, newGame, play, rulesOf, startRound } from '../../src/game/engine';
import { decisionContext, moveFeatures } from '../../src/game/features';
import { redactFor } from '../../src/game/info';
import { learnedPlay } from '../../src/game/policy';
import { attackerValue, cloneState, determinize, moveOptions, searchBury, searchPlay } from '../../src/game/search';
import { liveMove } from '../../src/game/live';

const target = Number(process.argv[2] ?? 1000);
const samples = Number(process.argv[3] ?? 32);
const out = process.argv[4] ?? 'data.jsonl';
const nm = () => '';
const LEVEL_WEIGHT = Number(process.env.LEVEL_WEIGHT ?? 20);
// DECKS=3 generates 3-deck training data; NT_ONLY=1 only no-trump rounds (for a no-trump model)
const DECKS = Number(process.env.DECKS ?? 2);
// HARD_GAMES=1: the games are played by Hard bots on every seat (the live pipeline: model + search + rules), so the
// training positions are the ones Hard bots actually reach against each other. Each decision is still scored by
// playouts with the trained model on every seat (a full Hard search inside every playout would cost thousands of times
// more). A few heuristic moves keep the positions varied.
const HARD = !!process.env.HARD_GAMES;
const hardMove = (v: GameState, seat: number) => liveMove(v, seat, (prior) => searchPlay(v, seat, DECKS === 3 ? 24 : 48, false, prior, LEVEL_WEIGHT));

function playout(d: GameState, seat: number, move: string[]): number {
  if (play(d, seat, move, nm)) return 0;
  if (d.trick!.winner !== null) collectTrick(d, nm);
  while (d.phase === 'playing') {
    play(d, d.turn, learnedPlay(d, d.turn), nm);
    if (d.trick!.winner !== null) collectTrick(d, nm);
  }
  const attacking = seat % 2 !== d.dealer! % 2;
  const v = attackerValue(d.result!.attackerPoints, LEVEL_WEIGHT, rulesOf(d));
  return attacking ? v : -v;
}

writeFileSync(out, '');
let made = 0;
const t0 = Date.now();
while (made < target) {
  const s = newGame(2, DECKS);
  startRound(s);
  while (s.phase === 'dealing') {
    const seat = dealOne(s, 0);
    const o = botDeclare(redactFor(s, seat), seat);
    if (o) declare(s, seat, o.cardIds);
  }
  finalizeDeclaration(s);
  if (process.env.NT_ONLY && s.trumpSuit !== 'NT') continue; // NT_ONLY=1: no-trump rounds only
  // HARD_GAMES=1: the dealer buries as a Hard bot does (searched burial)
  bury(s, s.dealer!, HARD ? searchBury(redactFor(s, s.dealer!), s.dealer!) : botBury(redactFor(s, s.dealer!), s.dealer!));
  while (s.phase === 'playing' && made < target) {
    const seat = s.turn;
    const view = redactFor(s, seat);
    if (Math.random() < 0.3 && s.hands[seat].length > 1) {
      const options = moveOptions(view, seat); // option 0 = heuristic bot's move
      if (options.length > 1) {
        try {
          const deals = Array.from({ length: samples }, () => determinize(view, seat));
          const q = options.map((m) => deals.reduce((t, d) => t + playout(cloneState(d), seat, m), 0) / samples);
          const dc = decisionContext(view, seat, options[0]);
          const hand = s.hands[seat];
          const f = options.map((m) => moveFeatures(dc, hand.filter((c) => m.includes(c.id))).map((x) => +x.toFixed(4)));
          appendFileSync(out, JSON.stringify({ lead: s.trick!.plays.length === 0, q: q.map((x) => +x.toFixed(2)), f }) + '\n');
          made++;
          if (made % 200 === 0) console.error(`${out}: ${made}/${target} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
        } catch {
          /* rare: skip */
        }
      }
    }
    // the game itself follows the trained model, with 15% heuristic moves so it sees varied positions
    const ids = HARD ? (Math.random() < 0.08 ? botPlay(view, seat) : hardMove(view, seat)) : Math.random() < 0.15 ? botPlay(view, seat) : learnedPlay(view, seat);
    play(s, seat, ids, nm);
    if (s.trick!.winner !== null) collectTrick(s, nm);
  }
}
