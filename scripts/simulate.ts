// Headless sanity check: plays many full rounds with 4 bots and verifies engine invariants.
import { basicPlay, botBury, botDeclare, botPlay, legalFollow, splitsTriple } from '../src/game/bot';
import { noRiskyPointLead, noRiskyPointsMove, searchPlay, settledTrickMove } from '../src/game/search';
import { redactFor } from '../src/game/info';
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
  rulesFor,
  startRound,
} from '../src/game/engine';
import { checkThrow, validateFollow, cardValue, decompose, trickWinner, TrumpCtx } from '../src/game/rules';
import { Card } from '../src/game/cards';

const names = (s: number) => `P${s}`;

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
// A throw anyone can beat is cut down to the beatable part, and the rest goes back to the leader's hand
{
  const g = newGame();
  startRound(g);
  g.dealer = 0;
  g.trumpSuit = 'H';
  g.phase = 'playing';
  g.hands = [[C('S', 7), C('S', 13), C('C', 3)], [C('S', 14), C('C', 4)], [C('C', 5), C('C', 6)], [C('C', 8), C('C', 9)]];
  g.trick = { leader: 0, plays: [], winner: null, points: 0 };
  g.turn = 0;
  assert(play(g, 0, ['0S7', '0S13'], names) === null, 'throw accepted for checking');
  assert(g.trick!.plays[0].cards.length === 1 && g.trick!.plays[0].cards[0].id === '0S7', 'blocked throw plays only the weakest part');
  assert(g.hands[0].some((c) => c.id === '0S13'), 'taken-back card returns to hand');
  const ev = g.events[g.events.length - 1];
  assert(ev.kind === 'throwFail' && ev.cards?.[0].id === '0S13', 'blocked throw reveals the returned card');
  // House rule: a player out of the suit who holds a trump blocks a throw of singles
{
  const g2 = newGame();
  startRound(g2);
  g2.dealer = 0;
  g2.trumpSuit = 'C';
  g2.trumpRank = 4;
  g2.phase = 'playing';
  g2.hands = [[C('H', 10), C('H', 11), C('S', 3)], [C('S', 5), C('C', 6)], [C('S', 6), C('S', 7)], [C('S', 8), C('S', 9)]];
  g2.trick = { leader: 0, plays: [], winner: null, points: 0 };
  g2.turn = 0;
  assert(play(g2, 0, ['0H10', '0H11'], names) === null, 'throw submitted');
  assert(g2.trick!.plays[0].cards.length === 1, 'throw blocked because seat 1 is out of hearts and holds a trump');
}
// ...but a throw nobody can beat stands
  const h = newGame();
  startRound(h);
  h.dealer = 0;
  h.trumpSuit = 'H';
  h.phase = 'playing';
  h.hands = [[C('S', 14), C('S', 13), C('S', 13, 1)], [C('S', 12), C('C', 4), C('C', 7)], [C('C', 5), C('C', 6), C('C', 9)], [C('C', 8), C('C', 10), C('C', 11)]];
  h.trick = { leader: 0, plays: [], winner: null, points: 0 };
  h.turn = 0;
  assert(play(h, 0, ['0S14', '0S13', '1S13'], names) === null && h.trick!.plays[0].cards.length === 3, 'unbeatable throw stands');
}
// Following a trump single you can't usefully win: spend the lone trump, keep the trump pair together
{
  const g = newGame();
  startRound(g);
  g.dealer = 1;
  g.trumpRank = 2; // the 2s are level cards (trump); old bot split its trump 7s instead of spending one
  g.trumpSuit = 'H';
  g.phase = 'playing';
  g.hands = [
    [C('H', 7), C('H', 7, 1), C('S', 2), C('S', 9), C('C', 6)],
    [C('S', 3), C('C', 3), C('D', 3), C('D', 5), C('C', 8)],
    [C('S', 6), C('C', 9), C('D', 7), C('D', 8), C('S', 8)],
    [C('S', 5), C('C', 5), C('D', 9), C('D', 10), C('S', 11)],
  ];
  g.trick = { leader: 3, plays: [{ seat: 3, cards: [C('H', 14)] }], winner: null, points: 0 };
  g.hands[3] = g.hands[3].slice(1);
  g.turn = 0;
  const heuristic = botPlay(g, 0);
  assert(heuristic.length === 1 && heuristic[0] === '0S2', `heuristic keeps the 7s paired (played ${heuristic})`);
  const searched = searchPlay(g, 0, 48);
  assert(searched.length === 1 && searched[0] === '0S2', `search keeps the 7s paired (played ${searched})`);
}
// Last to play with partner's pair winning: feed the K♦ (10 pts), don't throw away 4♦7♦ (reported from a real game)
{
  const g = newGame();
  startRound(g);
  g.dealer = 1;
  g.trumpRank = 2;
  g.trumpSuit = 'S';
  g.phase = 'playing';
  g.hands = [
    [C('D', 4), C('D', 7), C('D', 13), C('D', 14), C('C', 5), C('H', 9)],
    [C('C', 3), C('C', 4), C('H', 3), C('H', 4)],
    [C('C', 6), C('C', 7), C('H', 6), C('H', 7)],
    [C('C', 8), C('C', 9), C('H', 8), C('H', 10)],
  ];
  g.trick = {
    leader: 1,
    plays: [
      { seat: 1, cards: [C('D', 11), C('D', 11, 1)] },
      { seat: 2, cards: [C('D', 12), C('D', 12, 1)] },
      { seat: 3, cards: [C('D', 3), C('D', 4, 1)] },
    ],
    winner: null,
    points: 0,
  };
  g.played = g.trick.plays.flatMap((p) => p.cards);
  g.turn = 0;
  const m = settledTrickMove(redactFor(g, 0), 0);
  assert(m !== null && m.includes('0D13'), `last to play behind partner's winning pair: feed the K (played ${m})`);
}
// --- three decks: triples ---
{
  const c3: TrumpCtx = { suit: 'H', rank: 2 };
  const T = (suit: Card['suit'], rank: number) => [0, 1, 2].map((d) => C(suit, rank, d));
  const d1 = decompose(T('S', 9), c3);
  assert(d1.length === 1 && d1[0].kind === 'triple' && d1[0].width === 3, 'three identical cards are a triple');
  const d2 = decompose([...T('S', 9), ...T('S', 10)], c3);
  assert(d2.length === 1 && d2[0].kind === 'tractor' && d2[0].width === 3 && d2[0].len === 2, 'consecutive triples are a tractor');
  const d3 = decompose([...T('S', 14), C('S', 13), C('S', 13, 1)], c3);
  assert(d3.length === 2 && d3[0].kind === 'triple' && d3[1].kind === 'pair', 'AAA KK is a triple and a pair');
  // following a triple: a triple if you have one, otherwise a pair
  const lead3 = T('S', 9);
  const withTriple = [...T('S', 4), C('S', 6), C('S', 6, 1), C('S', 7)];
  assert(validateFollow([C('S', 6), C('S', 6, 1), C('S', 7)], withTriple, lead3, c3) !== null, 'must play the triple');
  assert(validateFollow(T('S', 4), withTriple, lead3, c3) === null, 'triple follows triple');
  const withPair = [C('S', 6), C('S', 6, 1), C('S', 7), C('S', 8)];
  assert(validateFollow([C('S', 6), C('S', 7), C('S', 8)], withPair, lead3, c3) !== null, 'no triple: must play a pair');
  assert(validateFollow([C('S', 6), C('S', 6, 1), C('S', 8)], withPair, lead3, c3) === null, 'pair + single follows a triple');
  const onlyTriple = [...T('S', 4), C('S', 7)];
  // a pair lead never forces a triple apart: any two cards of the suit will do, though two of the triple may be played
  assert(validateFollow([C('S', 4), C('S', 7)], onlyTriple, [C('S', 9), C('S', 9, 1)], c3) === null, 'triple kept intact against a pair');
  assert(validateFollow([C('S', 4), C('S', 4, 1)], onlyTriple, [C('S', 9), C('S', 9, 1)], c3) === null, 'two of a triple may answer a pair');
  const bp = legalFollow(onlyTriple, [C('S', 9), C('S', 9, 1)], c3);
  assert(bp.filter((c) => c.rank === 4).length < 3 && bp.some((c) => c.rank === 7), `bot keeps its triple (played ${bp.map((c) => c.id)})`);
  // bots keep triples whole when they can: leading from a hand of a triple and a loose card leads the loose card
  {
    const g = newGame(2, 3);
    startRound(g);
    g.dealer = 1;
    g.trumpSuit = 'H';
    g.trumpRank = 2;
    g.phase = 'playing';
    g.hands = [[...T('S', 7), C('C', 9)], [C('S', 3)], [C('S', 4)], [C('S', 6)]];
    g.trick = { leader: 0, plays: [], winner: null, points: 0 };
    g.turn = 0;
    const lead = botPlay(g, 0);
    assert(!splitsTriple(g.hands[0], g.hands[0].filter((c) => lead.includes(c.id))), `bot leads without splitting its triple (led ${lead})`);
  }
  // ...but a real pair is still owed
  const tripleAndPair = [...T('S', 4), C('S', 6), C('S', 6, 1), C('S', 7)];
  assert(validateFollow([C('S', 4), C('S', 7)], tripleAndPair, [C('S', 9), C('S', 9, 1)], c3) !== null, 'a real pair is owed to a pair');
  assert(validateFollow([C('S', 6), C('S', 6, 1)], tripleAndPair, [C('S', 9), C('S', 9, 1)], c3) === null, 'real pair answers a pair');
  // a pair tractor isn't owed out of a triple tractor
  const leadPT = [C('S', 9), C('S', 9, 1), C('S', 10), C('S', 10, 1)];
  const tripleTractorHand = [...T('S', 5), ...T('S', 6), C('S', 12), C('S', 13)];
  assert(validateFollow([C('S', 5), C('S', 6), C('S', 12), C('S', 13)], tripleTractorHand, leadPT, c3) === null, 'triple tractor kept intact against a pair tractor');
  // a triple is still owed to a triple
  assert(validateFollow([C('S', 4), C('S', 4, 1), C('S', 7)], [...T('S', 4), C('S', 7), C('S', 8)], lead3, c3) !== null, 'a triple is owed to a triple');
  // triple tractor: answer with a triple tractor, else a pair tractor
  const leadTT = [...T('S', 9), ...T('S', 10)];
  const handTT = [...T('S', 5), ...T('S', 6), C('S', 12), C('S', 13)];
  assert(validateFollow([...T('S', 5), C('S', 6), C('S', 12), C('S', 13)], handTT, leadTT, c3) !== null, 'must play the triple tractor');
  assert(validateFollow([...T('S', 5), ...T('S', 6)], handTT, leadTT, c3) === null, 'triple tractor follows');
  const handPT = [C('S', 5), C('S', 5, 1), C('S', 6), C('S', 6, 1), C('S', 12), C('S', 13), C('S', 3)];
  assert(validateFollow([C('S', 5), C('S', 5, 1), C('S', 12), C('S', 13), C('S', 3), C('S', 6)], handPT, leadTT, c3) !== null, 'no triple tractor: must play the pair tractor');
  assert(validateFollow([C('S', 5), C('S', 5, 1), C('S', 6), C('S', 6, 1), C('S', 12), C('S', 13)], handPT, leadTT, c3) === null, 'pair tractor follows a triple tractor');
  // giving triples for a triple tractor doesn't also require a pair tractor (both wouldn't fit in 6 cards)
  const twoTriples = [...T('S', 4), ...T('S', 12), C('S', 6), C('S', 6, 1), C('S', 7), C('S', 7, 1)];
  assert(validateFollow([...T('S', 4), ...T('S', 12)], twoTriples, leadTT, c3) === null, 'two triples answer a triple tractor');
  const bf = legalFollow(twoTriples, leadTT, c3);
  assert(bf.length === 6 && validateFollow(bf, twoTriples, leadTT, c3) === null, 'bot follows a triple tractor with two triples');
  // a throw of a triple and a pair tractor, answered with a triple that also forms the tractor
  const leadMix = [...T('S', 13), C('S', 9), C('S', 9, 1), C('S', 10), C('S', 10, 1)];
  const mixHand = [...T('S', 5), C('S', 6), C('S', 6, 1), C('S', 3), C('S', 8), C('S', 11)];
  const mf = legalFollow(mixHand, leadMix, c3);
  assert(mf.length === 7 && validateFollow(mf, mixHand, leadMix, c3) === null, 'bot builds 555 66 for a triple + tractor throw');
  // winning: only a higher triple (or a trump triple) beats a triple
  const w3 = trickWinner(
    [
      { seat: 0, cards: T('S', 9) },
      { seat: 1, cards: [C('S', 14), C('S', 14, 1), C('S', 13)] },
      { seat: 2, cards: T('S', 11) },
      { seat: 3, cards: [C('H', 5), C('H', 5, 1), C('H', 6)] },
    ],
    c3,
  );
  assert(w3 === 2, 'higher triple wins; a pair + single and trump pair + single do not');
  const w4 = trickWinner([{ seat: 0, cards: T('S', 9) }, { seat: 1, cards: T('H', 3) }, { seat: 2, cards: T('S', 11) }, { seat: 3, cards: T('S', 3) }], c3);
  assert(w4 === 1, 'trump triple ruffs a triple');
  // a triple in a throw is blocked by a higher triple
  const f3 = checkThrow([...T('S', 13), C('S', 14)], [[...T('S', 14).slice(1), C('S', 3)], T('S', 14).slice(0, 0)], c3);
  assert(f3 === null, 'nobody holds a higher triple or single: throw stands');
  const f4 = checkThrow([...T('S', 12), C('S', 14)], [[...T('S', 13)]], c3);
  assert(f4 !== null && f4.kind === 'triple', 'throw fails on the Q triple');
  // declaring: a triple outranks any pair, and only a bigger triple outranks it
  const g = newGame(2, 3);
  startRound(g);
  g.hands[0] = [C('J', 16), C('J', 16, 1)];
  g.hands[1] = T('C', 2);
  g.hands[2] = [C('D', 2), C('D', 2, 1)];
  g.hands[3] = T('J', 15);
  assert(declareOptions(g, 0).length === 0 && declare(g, 0, ['0J16', '1J16']) !== null, '3 decks: a joker pair does not declare');
  assert(declare(g, 2, ['0D2', '1D2']) === null, 'rank pair declares');
  const tri = declareOptions(g, 1).find((o) => o.strength === 5);
  assert(tri && declare(g, 1, tri.cardIds) === null && g.trumpSuit === 'C', 'rank triple overrides a pair');
  assert(declareOptions(g, 2).length === 0, 'a pair cannot override a triple');
  const jt = declareOptions(g, 3).find((o) => o.suit === 'NT');
  assert(jt && jt.strength === 6, 'small-joker triple overrides a rank triple');
  // 3-deck scoring: 120 to win, every 40 a level
  const levelsAt = (pts: number) => {
    const r = newGame(2, 3);
    startRound(r);
    r.dealer = 0;
    r.trumpSuit = 'S';
    r.phase = 'playing';
    r.hands = [[C('S', 3)], [C('S', 4)], [C('S', 6)], [C('S', 7)]];
    r.kitty = [];
    r.attackerPoints = pts;
    r.trick = { leader: 0, plays: [], winner: null, points: 0 };
    r.turn = 0;
    for (let i = 0; i < 4; i++) play(r, r.turn, [r.hands[r.turn][0].id], names);
    collectTrick(r, names);
    return [r.result!.winnerTeam, r.result!.levelsGained];
  };
  const expect: [number, number, number][] = [[0, 0, 3], [35, 0, 3], [40, 0, 2], [75, 0, 2], [80, 0, 1], [115, 0, 1], [120, 1, 0], [155, 1, 0], [160, 1, 1], [200, 1, 2]];
  for (const [pts, team, gained] of expect) {
    const [t, gn] = levelsAt(pts);
    assert(t === team && gn === gained, `3 decks, ${pts} points: team ${team} +${gained} (got team ${t} +${gn})`);
  }
}
// Partner leads a 9, the next opponent plays under it, and the last opponent still plays with higher spades out:
// don't put a 5 or 10 onto the 9 (reported from a real game: the model fed points the opponent would take)
{
  const g = newGame();
  startRound(g);
  g.dealer = 1;
  g.trumpRank = 2;
  g.trumpSuit = 'H';
  g.phase = 'playing';
  const side = [C('C', 3), C('C', 6), C('D', 7), C('D', 8), C('C', 11), C('D', 12), C('C', 4), C('D', 3)];
  g.hands = [
    [C('C', 7), C('C', 8), C('C', 9), C('D', 4), C('D', 5), C('D', 6), C('C', 10), C('D', 9), C('D', 10), C('C', 12)],
    [C('C', 13), C('C', 14), C('D', 13), C('D', 14), C('C', 5), C('D', 11), C('H', 3), C('H', 4), C('H', 5), C('H', 6)],
    [C('S', 5), C('S', 3), C('S', 8), ...side],
    [C('S', 14), C('S', 13), C('S', 12), C('S', 11), C('S', 10), C('H', 7), C('H', 8), C('H', 9), C('H', 10), C('H', 11), C('H', 12)],
  ];
  g.trick = { leader: 0, plays: [{ seat: 0, cards: [C('S', 9)] }, { seat: 1, cards: [C('S', 4)] }], winner: null, points: 0 };
  g.played = [C('S', 9), C('S', 4)];
  g.turn = 2;
  const m = noRiskyPointsMove(redactFor(g, 2), 2, ['0S5']);
  assert(m.length === 1 && m[0] !== '0S5' && m[0].startsWith('0S'), `no points onto a 9 the last opponent can beat (played ${m})`);
}
// Don't lead a trump 10 with both jokers still out (reported from a real game); a 10 nothing can beat is fine
{
  const g = newGame();
  startRound(g);
  g.dealer = 0;
  g.trumpRank = 2;
  g.trumpSuit = 'H';
  g.phase = 'playing';
  g.hands = [
    [C('H', 10), C('H', 4), C('H', 6), C('C', 9), C('C', 12), C('D', 8)],
    [C('J', 16), C('C', 3), C('C', 4), C('D', 3), C('D', 4), C('S', 3)],
    [C('J', 16, 1), C('C', 5), C('C', 6), C('D', 5), C('D', 6), C('S', 4)],
    [C('C', 7), C('C', 8), C('D', 7), C('D', 9), C('S', 5), C('S', 6)],
  ];
  g.trick = { leader: 0, plays: [], winner: null, points: 0 };
  g.turn = 0;
  const m = noRiskyPointLead(redactFor(g, 0), 0, ['0H10']);
  assert(m.length === 1 && totalPoints(g.hands[0].filter((c) => m.includes(c.id))) === 0, `no trump 10 led into unseen jokers (led ${m})`);
  // once every higher trump has been played, the 10 is a safe lead
  const safe = newGame();
  Object.assign(safe, structuredClone(g));
  safe.played = [...['J15', 'J16'].flatMap((k) => [C('J', Number(k.slice(1)), 0), C('J', Number(k.slice(1)), 1)]),
    ...['S', 'C', 'D', 'H'].flatMap((x) => [C(x as Card['suit'], 2), C(x as Card['suit'], 2, 1)]),
    ...[11, 12, 13, 14].flatMap((r) => [C('H', r), C('H', r, 1)]), C('H', 10, 1)];
  safe.hands = safe.hands.map((h) => h.filter((c) => !safe.played.some((p) => p.id === c.id) || c.id === '0H10'));
  assert(noRiskyPointLead(redactFor(safe, 0), 0, ['0H10'])[0] === '0H10', 'a trump 10 nothing can beat may be led');
}
console.log('rule checks passed');

// --- full games: team 0 (seats 0, 2) plays the strong bot, team 1 a simple baseline ---
let rounds = 0;
let throwsFailed = 0;
const wins = [0, 0];
const games = Number(process.argv[2] ?? 30);
const mode = process.argv[3] ?? 'vs';
const decks = Number(process.argv[4] ?? 2);
const deckRules = rulesFor(decks);
const player = (seat: number) => (mode === 'vs' && seat % 2 === 1 ? basicPlay : botPlay);
for (let g = 0; g < games; g++) {
  const s = newGame(2, decks);
  startRound(s);
  for (let guard = 0; guard < 200 && s.phase !== 'gameOver'; guard++) {
    while (s.phase === 'dealing') {
      const seat = dealOne(s, 0);
      const opt = botDeclare(s, seat);
      if (opt) assert(declare(s, seat, opt.cardIds) === null, 'bot declare valid');
    }
    finalizeDeclaration(s);
    const handSize = (54 * decks - deckRules.kitty) / 4;
    assert(s.hands[s.dealer!].length === handSize + deckRules.kitty, `dealer has ${handSize + deckRules.kitty}`);
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
    assert(r.attackerPoints - r.kittyBonus <= deckRules.points, `points <= ${deckRules.points}`);
    assert(totalPoints(r.kitty) === r.kittyPoints, 'kitty points');
    rounds++;
    if (s.phase === 'roundEnd') nextRound(s);
  }
  assert(s.phase === 'gameOver', 'game finished');
  wins[s.result!.gameWinner!]++;
}
console.log(`${decks} decks: ${games} games, ${rounds} rounds simulated OK (${throwsFailed} failed throws)`);
console.log(`games won — strong team: ${wins[0]}, ${mode === 'vs' ? 'baseline' : 'strong'} team: ${wins[1]}`);
