/**
 * Sound effects synthesized with the Web Audio API — no audio files to host.
 * The AudioContext is created on the first user gesture (browsers block audio before that).
 */
import { useSyncExternalStore } from 'react';
import { cardDeal, cardPlay } from './cardSounds';
import { IN_APP } from '../net/site';

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
// Battery: a running AudioContext keeps the audio hardware awake even in silence, so after a quiet spell we suspend
// it, and resume at the next sound. `idleSuspended` marks a suspend that was ours (not the browser's autoplay block).
const IDLE_MS = 8000;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let idleSuspended = false;
let resuming: Promise<void> | null = null;
function scheduleIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (ctx && ctx.state === 'running') {
      idleSuspended = true;
      void ctx.suspend().catch(() => {});
    }
  }, IDLE_MS);
}
// iOS app: sounds are rendered once and played natively (nativeSound.ts), since WebKit holds web audio for several
// seconds after the app returns from the background. Until that's set up the app plays nothing; with an older app
// build that lacks the native player, nativeSound.ts calls useWebAudio() and web audio is used as on the site.
type NativePlayer = (name: SoundName) => void;
let native: NativePlayer | null = null;
let nativePending = IN_APP;
export function setNativePlayer(p: NativePlayer) {
  native = p;
  nativePending = false;
}
export function useWebAudio() {
  nativePending = false;
}

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
    scheduleIdle();
  }
  // 'suspended' after autoplay blocking, 'interrupted' (Safari) after the page was in the background
  if (ctx.state !== 'running' && ctx.state !== 'closed') {
    // Ask again on every call, never just wait on an earlier request: iOS leaves a resume asked for outside a tap
    // pending forever, and only a resume called inside a tap goes through.
    const a = ctx;
    const r: Promise<void> = a.resume().catch(() => {}).finally(() => {
      if (resuming === r) resuming = null;
    });
    resuming = r;
    scheduleIdle();
  }
  return ctx;
}

// Unlock audio on interaction. Not just the first one: phones suspend audio whenever the page leaves the screen,
// and only a tap is guaranteed to be allowed to start it again.
if (typeof window !== 'undefined') {
  const unlock = () => {
    if (!native && !nativePending) audio();
  };
  window.addEventListener('pointerdown', unlock);
  // iOS only lets audio start on a touch's end or a click, not on its start
  window.addEventListener('touchend', unlock);
  window.addEventListener('click', unlock);
  window.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // iOS can leave a backgrounded context "running" but silent; start a fresh one when we're back
      void ctx?.close().catch(() => {});
      ctx = null;
      noise = null;
      idleSuspended = false;
    } else if (!native && !nativePending) audio();
  });
}

function noiseBuffer(a: BaseAudioContext): AudioBuffer {
  if (!noise) {
    noise = a.createBuffer(1, a.sampleRate * 0.5, a.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noise;
}

function play(name: SoundName) {
  if (muted || document.visibilityState === 'hidden') return;
  if (native) return native(name);
  if (nativePending) return;
  const { build, volume } = SOUNDS[name];
  const a = audio();
  if (!a) return;
  const go = () => {
    const out = a.createGain();
    out.gain.value = volume;
    out.connect(a.destination);
    build(a, out, a.currentTime + 0.005);
    scheduleIdle();
  };
  if (a.state === 'running') return go();
  // suspended by us for battery: play once it's back, unless that took so long the sound would be late
  if (!idleSuspended || !resuming) return;
  const asked = performance.now();
  void resuming.then(() => {
    if (a === ctx && a.state === 'running' && performance.now() - asked < 250) {
      idleSuspended = false;
      go();
    }
  });
}

function tone(a: BaseAudioContext, out: AudioNode, t: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sine', attack = 0.01, toFreq?: number) {
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

type Build = (a: BaseAudioContext, out: GainNode, t: number) => void;

export type SoundName = 'card' | 'deal' | 'sweep' | 'coin' | 'theirPoints' | 'declare' | 'turn' | 'win' | 'lose' | 'error';

/** Every sound: how to build it, its level, and its length (for rendering it ahead of time in the app). */
export const SOUNDS: Record<SoundName, { build: Build; volume: number; dur: number }> = {
  /** A card played: a swish and a light tap (see cardSounds.ts). */
  card: {
    build: (a, out, t) => cardPlay(a, out, noiseBuffer(a), t),
    volume: MASTER * 0.7,
    dur: 0.5,
  },
  /** A card flicked across the table while dealing: quieter than a play, since a deal is a hundred of them. */
  deal: {
    build: (a, out, t) => cardDeal(a, out, noiseBuffer(a), t),
    volume: MASTER * 0.4,
    dur: 0.4,
  },
  /** Cards gathered to the trick winner: a quiet brush. */
  sweep: {
    build: (a, out, t) => {
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
    },
    volume: MASTER,
    dur: 0.5,
  },
  /** Your team takes a trick with points (won when attacking, blocked when defending): a gentle two-note chime. */
  coin: {
    build: (a, out, t) => {
      tone(a, out, t, 1047, 0.4, 0.05, 'sine', 0.01);
      tone(a, out, t + 0.08, 1568, 0.5, 0.04, 'sine', 0.01);
    },
    volume: MASTER,
    dur: 0.7,
  },
  /** The opponents take a trick with points: a soft, low falling pair, quieter and shorter than losing a round. */
  theirPoints: {
    build: (a, out, t) => {
      tone(a, out, t, 294, 0.22, 0.04, 'sine', 0.01);
      tone(a, out, t + 0.11, 247, 0.3, 0.035, 'sine', 0.01);
    },
    volume: MASTER,
    dur: 0.5,
  },
  /** Trump declared: a soft, low bell. */
  declare: {
    build: (a, out, t) => {
      tone(a, out, t, 262, 1.2, 0.12, 'sine', 0.02);
      tone(a, out, t, 392, 0.9, 0.05, 'sine', 0.02);
    },
    volume: MASTER,
    dur: 1.3,
  },
  /** It's your turn: one quiet note. */
  turn: {
    build: (a, out, t) => tone(a, out, t, 784, 0.45, 0.045, 'sine', 0.02),
    volume: MASTER,
    dur: 0.6,
  },
  win: {
    build: (a, out, t) => {
      [523, 659, 784].forEach((f, i) => tone(a, out, t + i * 0.13, f, 0.6, 0.07, 'sine', 0.02));
    },
    volume: MASTER,
    dur: 0.95,
  },
  lose: {
    build: (a, out, t) => {
      tone(a, out, t, 392, 0.5, 0.06, 'sine', 0.02);
      tone(a, out, t + 0.2, 330, 0.7, 0.05, 'sine', 0.02);
    },
    volume: MASTER,
    dur: 1.0,
  },
  error: {
    build: (a, out, t) => tone(a, out, t, 220, 0.15, 0.05, 'sine', 0.01, 180),
    volume: MASTER,
    dur: 0.25,
  },
};

export const sfx = Object.fromEntries(Object.keys(SOUNDS).map((n) => [n, () => play(n as SoundName)])) as Record<
  SoundName,
  () => void
>;

/** Renders a sound offline (no audio output needed) for the app's native player. */
export async function renderSound(name: SoundName, sampleRate: number): Promise<Float32Array> {
  const { build, volume, dur } = SOUNDS[name];
  const a = new OfflineAudioContext(1, Math.ceil(sampleRate * dur), sampleRate);
  const out = a.createGain();
  out.gain.value = volume;
  out.connect(a.destination);
  build(a, out, 0.005);
  return (await a.startRendering()).getChannelData(0);
}
