/**
 * Sound effects synthesized with the Web Audio API — no audio files to host.
 * The AudioContext is created on the first user gesture (browsers block audio before that).
 */
import { useSyncExternalStore } from 'react';

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let muted = loadMuted();
const listeners = new Set<() => void>();

function loadMuted(): boolean {
  try {
    return localStorage.getItem('sj-muted') === '1';
  } catch {
    return false;
  }
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem('sj-muted', m ? '1' : '0');
  } catch {
    /* ignore */
  }
  for (const fn of listeners) fn();
}

export function useMuted(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => muted,
  );
}

function audio(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  // 'suspended' after autoplay blocking, 'interrupted' (Safari) after the page was in the background
  if (ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => {});
  return ctx;
}

// Unlock audio on interaction. Not just the first one: phones suspend audio whenever the page leaves the screen,
// and only a tap is guaranteed to be allowed to start it again.
if (typeof window !== 'undefined') {
  const unlock = () => audio();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // iOS can leave a backgrounded context "running" but silent; start a fresh one when we're back
      void ctx?.close().catch(() => {});
      ctx = null;
      noise = null;
    } else audio();
  });
}

function noiseBuffer(a: AudioContext): AudioBuffer {
  if (!noise) {
    noise = a.createBuffer(1, a.sampleRate * 0.5, a.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noise;
}

function play(build: (a: AudioContext, out: GainNode, t: number) => void, volume = 1) {
  if (muted || document.visibilityState === 'hidden') return;
  const a = audio();
  if (!a || a.state !== 'running') return;
  const out = a.createGain();
  out.gain.value = volume;
  out.connect(a.destination);
  build(a, out, a.currentTime + 0.005);
}

/** Filtered noise burst — the "snap" of a card. */
function burst(a: AudioContext, out: AudioNode, t: number, dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass') {
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(a);
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.02);
}

function tone(a: AudioContext, out: AudioNode, t: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sine', attack = 0.01, toFreq?: number) {
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Overall level — kept low so effects sit in the background. */
const MASTER = 0.45;

export const sfx = {
  /**
   * A play set down on the felt, in three layers: a crisp edge snap, a soft felt body and a low touch for weight.
   * Tone, length and level vary a little each time so a run of plays doesn't sound like one sample on repeat.
   */
  card() {
    play((a, out, t) => {
      const v = () => 0.85 + Math.random() * 0.3;
      burst(a, out, t, 0.018 * v(), 2600 * v(), 1.4, 0.16 * v(), 'bandpass'); // edge snap
      burst(a, out, t + 0.002, 0.075 * v(), 750 * v(), 0.7, 0.24 * v(), 'lowpass'); // felt body
      tone(a, out, t, 115 * v(), 0.06, 0.05, 'sine', 0.004, 70); // low touch
    }, MASTER);
  },
  /**
   * A card flicked into your hand while dealing: a short swish that sweeps from bright to soft, quieter than a play
   * and slightly different each time so a whole deal doesn't drone.
   */
  deal() {
    play((a, out, t) => {
      const v = () => 0.85 + Math.random() * 0.3;
      const dur = 0.05 * v();
      const src = a.createBufferSource();
      src.buffer = noiseBuffer(a);
      src.playbackRate.value = v();
      const f = a.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 1.1;
      f.frequency.setValueAtTime(4200 * v(), t);
      f.frequency.exponentialRampToValueAtTime(1500 * v(), t + dur);
      const g = a.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.11 * v(), t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f).connect(g).connect(out);
      src.start(t, Math.random() * 0.3);
      src.stop(t + dur + 0.02);
      burst(a, out, t + dur * 0.8, 0.012, 1800 * v(), 1, 0.035, 'bandpass'); // the card landing
    }, MASTER);
  },
  /** Cards gathered to the trick winner: a quiet brush. */
  sweep() {
    play((a, out, t) => {
      const src = a.createBufferSource();
      src.buffer = noiseBuffer(a);
      const f = a.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 0.4;
      f.frequency.setValueAtTime(500, t);
      f.frequency.linearRampToValueAtTime(1400, t + 0.3);
      const g = a.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.12);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      src.connect(f).connect(g).connect(out);
      src.start(t);
      src.stop(t + 0.42);
    }, MASTER);
  },
  /** Attackers capture points: a gentle two-note chime. */
  coin() {
    play((a, out, t) => {
      tone(a, out, t, 1047, 0.4, 0.05, 'sine', 0.01);
      tone(a, out, t + 0.08, 1568, 0.5, 0.04, 'sine', 0.01);
    }, MASTER);
  },
  /** Trump declared: a soft, low bell. */
  declare() {
    play((a, out, t) => {
      tone(a, out, t, 262, 1.2, 0.12, 'sine', 0.02);
      tone(a, out, t, 392, 0.9, 0.05, 'sine', 0.02);
    }, MASTER);
  },
  /** It's your turn: one quiet note. */
  turn() {
    play((a, out, t) => tone(a, out, t, 784, 0.45, 0.045, 'sine', 0.02), MASTER);
  },
  win() {
    play((a, out, t) => {
      [523, 659, 784].forEach((f, i) => tone(a, out, t + i * 0.13, f, 0.6, 0.07, 'sine', 0.02));
    }, MASTER);
  },
  lose() {
    play((a, out, t) => {
      tone(a, out, t, 392, 0.5, 0.06, 'sine', 0.02);
      tone(a, out, t + 0.2, 330, 0.7, 0.05, 'sine', 0.02);
    }, MASTER);
  },
  error() {
    play((a, out, t) => tone(a, out, t, 220, 0.15, 0.05, 'sine', 0.01, 180), MASTER);
  },
};
