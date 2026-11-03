// Training data, round 2 (expert iteration): self-play games are played by the current trained model (with some
// exploration), and every sensible option is scored by Monte Carlo search whose playouts also use the trained model
// — a stronger teacher than round 1, whose games and playouts used the heuristic bot. One JSON line per decision.
//   npx tsx scripts/ml/gen2.ts <decisions> <deals-per-option> <out.jsonl>
import { appendFileSync, writeFileSync } from 'node:fs';
import { botBury, botDeclare, botPlay } from '../../src/game/bot';
import { bury, collectTrick, dealOne, declare, finalizeDeclaration, GameState, newGame, play, startRound } from '../../src/game/engine';
import { decisionContext, moveFeatures } from '../../src/game/features';
import { redactFor } from '../../src/game/info';
import { learnedPlay } from '../../src/game/policy';
import { cloneState, determinize, moveOptions } from '../../src/game/search';

const target = Number(process.argv[2] ?? 1000);
const samples = Number(process.argv[3] ?? 32);
const out = process.argv[4] ?? 'data.jsonl';
const nm = () => '';

function playout(d: GameState, seat: number, move: string[]): number {
  if (play(d, seat, move, nm)) return 0;
  if (d.trick!.winner !== null) collectTrick(d, nm);
  while (d.phase === 'playing') {
    play(d, d.turn, learnedPlay(d, d.turn), nm);
    if (d.trick!.winner !== null) collectTrick(d, nm);
  }
  const attacking = seat % 2 !== d.dealer! % 2;
  return attacking ? d.result!.attackerPoints : -d.result!.attackerPoints;
}

writeFileSync(out, '');
let made = 0;
const t0 = Date.now();
while (made < target) {
  const s = newGame();
  startRound(s);
  while (s.phase === 'dealing') {
    const seat = dealOne(s, 0);
    const o = botDeclare(redactFor(s, seat), seat);
    if (o) declare(s, seat, o.cardIds);
  }
  finalizeDeclaration(s);
  bury(s, s.dealer!, botBury(redactFor(s, s.dealer!), s.dealer!));
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
    const ids = Math.random() < 0.15 ? botPlay(view, seat) : learnedPlay(view, seat);
    play(s, seat, ids, nm);
    if (s.trick!.winner !== null) collectTrick(s, nm);
  }
}
