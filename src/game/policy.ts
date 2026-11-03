/*
 * Learned move scorer: a small neural network distilled from the Monte Carlo search (scripts/ml/train.py).
 * Scores every sensible option from features that use only legitimately known information, and plays the best.
 */
import { Card } from './cards';
import { GameState } from './engine';
import { decisionContext, FEATURE_NAMES, moveFeatures } from './features';
import { moveOptions } from './search';
import weights from './policyWeights.json';

interface Weights {
  features: string[];
  mean: number[];
  std: number[];
  layers: { W: number[][]; b: number[] }[];
}
const net = weights as Weights;
// weights may use a leading subset of the features (an older model after new features were added)
const fits = (w: Weights) => w.features.every((f, i) => f === FEATURE_NAMES[i]);
if (!fits(net)) throw new Error('policy weights were trained on different features');

function score(x: number[], net: Weights): number {
  let h = x.slice(0, net.features.length).map((v, i) => (v - net.mean[i]) / net.std[i]);
  net.layers.forEach((layer, li) => {
    const out = layer.b.slice();
    for (let o = 0; o < out.length; o++) {
      const row = layer.W[o];
      let sum = out[o];
      for (let i = 0; i < h.length; i++) sum += row[i] * h[i];
      out[o] = li < net.layers.length - 1 ? Math.max(0, sum) : sum;
    }
    h = out;
  });
  return h[0];
}

export function learnedPlay(s: GameState, seat: number): string[] {
  return playWith(net, s, seat);
}

/** A policy using other trained weights (for comparing a retrained model against the live one). */
export function learnedPlayWith(w: Weights) {
  if (!fits(w)) throw new Error('policy weights were trained on different features');
  return (s: GameState, seat: number) => playWith(w, s, seat);
}

function playWith(net: Weights, s: GameState, seat: number): string[] {
  const options = moveOptions(s, seat);
  if (options.length === 1) return options[0];
  const dc = decisionContext(s, seat, options[0]);
  const hand = s.hands[seat];
  let best = 0;
  let bestScore = -Infinity;
  options.forEach((m, i) => {
    const v = score(moveFeatures(dc, hand.filter((c: Card) => m.includes(c.id))), net);
    if (v > bestScore) {
      bestScore = v;
      best = i;
    }
  });
  return options[best];
}
