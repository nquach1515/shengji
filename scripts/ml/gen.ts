// Generates training data: at sampled decisions in self-play games, every sensible option is scored by
// determinized Monte Carlo search (the "teacher"). Output: one JSON line per decision.
//   npx tsx scripts/ml/gen.ts <decisions> <deals-per-option> <out.jsonl>
import { writeFileSync, appendFileSync } from 'node:fs';
import { botBury, botDeclare, botPlay } from '../../src/game/bot';
import { bury, collectTrick, dealOne, declare, finalizeDeclaration, newGame, play, startRound } from '../../src/game/engine';
import { decisionContext, moveFeatures } from '../../src/game/features';
import { cloneState, determinize, moveOptions, rollout } from '../../src/game/search';
import { redactFor } from '../../src/game/info';

const target = Number(process.argv[2] ?? 1000);
const samples = Number(process.argv[3] ?? 24);
const out = process.argv[4] ?? 'data.jsonl';
const nm = () => '';
writeFileSync(out, '');
let made = 0;
const t0 = Date.now();
while (made < target) {
  const s = newGame();
  startRound(s);
  while (s.phase === 'dealing') {
    const seat = dealOne(s, 0);
    const o = botDeclare(s, seat);
    if (o) declare(s, seat, o.cardIds);
  }
  finalizeDeclaration(s);
  bury(s, s.dealer!, botBury(s, s.dealer!));
  while (s.phase === 'playing' && made < target) {
    const seat = s.turn;
    if (Math.random() < 0.35 && s.hands[seat].length > 1) {
      // Everything below sees only a redacted copy: other hands and the face-down kitty are blanked out.
      const view = redactFor(s, seat);
      const options = moveOptions(view, seat); // option 0 = heuristic bot's move
      if (options.length > 1) {
        try {
          const deals = Array.from({ length: samples }, () => determinize(view, seat));
          const q = options.map((m) => deals.reduce((t, d) => t + rollout(cloneState(d), seat, m), 0) / samples);
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
    play(s, seat, botPlay(s, seat), nm);
    if (s.trick!.winner !== null) collectTrick(s, nm);
  }
}
