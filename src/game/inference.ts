/*
 * Reading the other players' play: how likely is a guessed deal, given what everyone has played recently?
 * For each recent play by another player, rebuild the position they faced (their hand in the guessed deal plus the
 * cards they've played since), ask the trained model how likely it would have been to choose what they actually
 * played, and multiply. Deals that make the actual play look natural then count for more in the search: partner
 * didn't feed points to a sure win → probably had none in that suit; someone led small diamonds → probably long.
 * Uses only what's public plus the guessed deal, so it can't leak hidden cards.
 */
import { Card, cardKey, totalPoints } from './cards';
import { GameState, teamOf, Trick } from './engine';
import { moveScores } from './policy';
import { effSuit } from './rules';
import { ctxOf } from './engine';
import { moveOptions } from './search';

export interface ReadParams {
  /** how many recent tricks to read (the current one counts if it has plays) */
  tricks: number;
  /** softmax temperature on the model's scores, in points (the model was trained with 4); lower = sharper */
  temp: number;
  /** share of each play explained as "anything goes": players (people especially) don't play like the model */
  eps: number;
}

export const READ_PARAMS: ReadParams = { tricks: 99, temp: 2, eps: 0.1 };

interface Moment {
  ti: number;
  pj: number;
  seat: number;
  playedBefore: number;
  attackerPoints: number;
  voids: string[][];
}

/**
 * Returns a function giving the log-likelihood of the recent plays for a guessed deal `d`, or null if there's
 * nothing to read. Built once per decision from `s` (the bot's redacted view).
 */
export function playReader(s: GameState, seat: number, p?: ReadParams): ((d: GameState) => number) | null {
  if (!p || p.tricks <= 0) return null;
  const { temp, eps } = p;
  const tricks: Trick[] = [...(s.history ?? []), ...(s.trick && s.trick.plays.length ? [s.trick] : [])];
  const first = Math.max(0, tricks.length - p.tricks);
  const ctx = ctxOf(s);
  const dealerTeam = teamOf(s.dealer!);
  const voids: string[][] = [[], [], [], []];
  const moments: Moment[] = [];
  const flat: { ti: number; pj: number; seat: number; cards: Card[] }[] = [];
  let points = 0;
  let playedBefore = 0;
  tricks.forEach((t, ti) => {
    t.plays.forEach((p, pj) => {
      flat.push({ ti, pj, seat: p.seat, cards: p.cards });
      if (ti >= first && p.seat !== seat) moments.push({ ti, pj, seat: p.seat, playedBefore, attackerPoints: points, voids: voids.map((v) => v.slice()) });
      if (pj > 0) {
        const lead = effSuit(t.plays[0].cards[0], ctx);
        if (p.cards.some((c) => effSuit(c, ctx) !== lead) && !voids[p.seat].includes(lead)) voids[p.seat].push(lead);
      }
      playedBefore += p.cards.length;
    });
    if (t.winner !== null && t.plays.length === 4 && teamOf(t.winner) !== dealerTeam) points += t.points;
  });
  if (moments.length === 0) return null;
  const firstIdx = flat.findIndex((f) => f.ti === moments[0].ti && f.pj === moments[0].pj);

  return (d: GameState) => {
    try {
      const hands = d.hands.map((h) => h.slice());
      let ll = 0;
      let mi = moments.length - 1;
      for (let i = flat.length - 1; i >= firstIdx; i--) {
        const f = flat[i];
        hands[f.seat].push(...f.cards);
        const m = moments[mi];
        if (!m || m.ti !== f.ti || m.pj !== f.pj) continue;
        mi--;
        const t = tricks[f.ti];
        const before = t.plays.slice(0, f.pj);
        const snap: GameState = {
          ...d,
          hands: hands.map((h) => h.slice()),
          trick: { leader: t.leader, plays: before, winner: null, points: totalPoints(before.flatMap((p) => p.cards)) },
          history: tricks.slice(0, f.ti),
          lastTrick: f.ti > 0 ? tricks[f.ti - 1] : null,
          tricksPlayed: f.ti,
          attackerPoints: m.attackerPoints,
          played: s.played.slice(0, m.playedBefore),
          voids: m.voids,
          maxCopies: undefined,
          turn: f.seat,
          phase: 'playing',
        };
        const hand = snap.hands[f.seat];
        const options = moveOptions(snap, f.seat);
        const keys = (ids: string[]) => hand.filter((c) => ids.includes(c.id)).map(cardKey).sort().join(',');
        const actual = f.cards.map(cardKey).sort().join(',');
        let k = options.findIndex((o) => keys(o) === actual);
        if (k < 0) {
          options.push(f.cards.map((c) => c.id));
          k = options.length - 1;
        }
        if (options.length === 1) continue;
        const z = moveScores(snap, f.seat, options).map((v) => v / temp);
        const top = Math.max(...z);
        const lse = top + Math.log(z.reduce((acc, v) => acc + Math.exp(v - top), 0));
        ll += Math.log(eps / options.length + (1 - eps) * Math.exp(z[k] - lse));
      }
      return ll;
    } catch {
      return 0;
    }
  };
}
