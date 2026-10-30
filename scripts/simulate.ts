// Headless sanity check: plays many full rounds with 4 bots and verifies engine invariants.
import { basicPlay, botBury, botDeclare, botPlay } from '../src/game/bot';
import { totalPoints } from '../src/game/cards';
import {
  bury,
  checkPlay,
  collectTrick,
  dealOne,
  declare,
  declareOptions,
  finalizeDeclaration,
  newGame,
  nextRound,
  play,
  startRound,
} from '../src/game/engine';
import { checkThrow, validateFollow, cardValue, decompose, trickWinner, TrumpCtx } from '../src/game/rules';
import { Card } from '../src/game/cards';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// --- targeted rule checks ---
const C = (suit: Card['suit'], rank: number, d = 0): Card => ({ id: `${d}${suit}${rank}`, suit, rank });
const ctx: TrumpCtx = { suit: 'H', rank: 2 };
// Tractor A♥A♥ + 2♠2♠ (off-suit rank right above trump ace)
assert(decompose([C('H', 14), C('H', 14, 1), C('S', 2), C('S', 2, 1)], ctx)[0].kind === 'tractor', 'A-2 trump tractor');
// 2♠2♠ + 2♣2♣ are equal rank — not a tractor
assert(decompose([C('S', 2), C('S', 2, 1), C('C', 2), C('C', 2, 1)], ctx)[0].kind === 'pair', 'off-suit rank pairs not tractor');
// Skipping trump rank: with rank 7, 6-6-8-8 is a tractor
const ctx7: TrumpCtx = { suit: 'S', rank: 7 };
assert(decompose([C('D', 6), C('D', 6, 1), C('D', 8), C('D', 8, 1)], ctx7)[0].kind === 'tractor', 'skip-rank tractor');
// Big joker beats small joker beats trump-suit rank card beats off-suit rank card
assert(cardValue(C('J', 16), ctx) > cardValue(C('J', 15), ctx), 'BJ>SJ');
assert(cardValue(C('J', 15), ctx) > cardValue(C('H', 2), ctx), 'SJ>2H');
assert(cardValue(C('H', 2), ctx) > cardValue(C('S', 2), ctx), '2H>2S');
assert(cardValue(C('S', 2), ctx) > cardValue(C('H', 14), ctx), '2S>AH');
// Must follow pair with pair
const lead = [C('S', 9), C('S', 9, 1)];
const hand = [C('S', 3), C('S', 4), C('S', 4, 1), C('C', 5)];
assert(validateFollow([C('S', 3), C('S', 4)], hand, lead, ctx) !== null, 'must play pair');
assert(validateFollow([C('S', 4), C('S', 4, 1)], hand, lead, ctx) === null, 'pair ok');
// Ruffing beats side suit; overruff beats ruff
const w = trickWinner(
  [
    { seat: 0, cards: [C('S', 14)] },
    { seat: 1, cards: [C('H', 3)] },
    { seat: 2, cards: [C('H', 5)] },
    { seat: 3, cards: [C('S', 13)] },
  ],
  ctx,
);
assert(w === 2, 'overruff wins');
// Pair lead can't be beaten by two trump singles
const w2 = trickWinner(
  [
    { seat: 0, cards: [C('S', 9), C('S', 9, 1)] },
    { seat: 1, cards: [C('H', 3), C('H', 4)] },
    { seat: 2, cards: [C('S', 3), C('S', 5)] },
    { seat: 3, cards: [C('H', 6), C('H', 6, 1)] },
  ],
  ctx,
);
assert(w2 === 3, 'trump pair ruff wins, singles do not');
// Throw: A♠ + K♠K♠ is beatable if someone holds A♠A♠ (pair beats the K pair) -> forced to play the K pair
const forced = checkThrow([C('S', 14), C('S', 13), C('S', 13, 1)], [[C('S', 14, 1), C('S', 3)], [C('S', 12), C('S', 12, 1)]], ctx);
assert(forced === null, 'throw stands: nobody holds a higher pair or single');
const forced2 = checkThrow([C('S', 13), C('S', 12), C('S', 12, 1)], [[C('S', 14)]], ctx);
assert(forced2 !== null && forced2.kind === 'single', 'throw fails on the K single');
// Jokers: a single joker can't declare; a pair declares no trump and outranks a rank-card pair
{
  const g = newGame();
  startRound(g);
  g.hands[1] = [C('J', 15), C('S', 5)];
  assert(!declareOptions(g, 1).some((o) => o.suit === 'NT'), 'single joker cannot declare');
  g.hands[1] = [C('J', 15), C('J', 15, 1)];
  g.hands[0] = [C('H', 2), C('H', 2, 1)];
  assert(declare(g, 0, ['0H2', '1H2']) === null, 'pair of 2s declares');
  const nt = declareOptions(g, 1).find((o) => o.suit === 'NT');
  assert(nt && declare(g, 1, nt.cardIds) === null && g.trumpSuit === 'NT', 'joker pair overrides to no trump');
}
console.log('rule checks passed');

// --- full games: team 0 (seats 0, 2) plays the strong bot, team 1 a simple baseline ---
const names = (s: number) => `P${s}`;
let rounds = 0;
let throwsFailed = 0;
const wins = [0, 0];
const games = Number(process.argv[2] ?? 30);
const mode = process.argv[3] ?? 'vs';
const player = (seat: number) => (mode === 'vs' && seat % 2 === 1 ? basicPlay : botPlay);
for (let g = 0; g < games; g++) {
  const s = newGame();
  startRound(s);
  for (let guard = 0; guard < 200 && s.phase !== 'gameOver'; guard++) {
    while (s.phase === 'dealing') {
      const seat = dealOne(s, 0);
      const opt = botDeclare(s, seat);
      if (opt) assert(declare(s, seat, opt.cardIds) === null, 'bot declare valid');
    }
    finalizeDeclaration(s);
    assert(s.hands[s.dealer!].length === 33, 'dealer has 33');
    assert(bury(s, s.dealer!, botBury(s, s.dealer!)) === null, 'bury ok');
    while (s.phase === 'playing') {
      const seat = s.turn;
      const ids = player(seat)(s, seat);
      const err = checkPlay(s, seat, ids);
      assert(err === null, `bot play invalid: ${err} round ${s.round}`);
      const before = s.events.length;
      play(s, seat, ids, names);
      if (s.events.length > before && s.events[s.events.length - 1].kind === 'throwFail') throwsFailed++;
      if (s.trick!.winner !== null) {
        const sizes = new Set(s.trick!.plays.map((p) => p.cards.length));
        assert(sizes.size === 1, 'all plays same size');
        collectTrick(s, names);
      }
    }
    const r = s.result!;
    assert(r.attackerPoints - r.kittyBonus <= 200, 'points <= 200');
    assert(totalPoints(r.kitty) === r.kittyPoints, 'kitty points');
    rounds++;
    if (s.phase === 'roundEnd') nextRound(s);
  }
  assert(s.phase === 'gameOver', 'game finished');
  wins[s.result!.gameWinner!]++;
}
console.log(`${games} games, ${rounds} rounds simulated OK (${throwsFailed} failed throws)`);
console.log(`games won — strong team: ${wins[0]}, ${mode === 'vs' ? 'baseline' : 'strong'} team: ${wins[1]}`);
