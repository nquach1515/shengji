/**
 * Sound effects synthesized with the Web Audio API — no audio files to host.
 * The AudioContext is created on the first user gesture (browsers block audio before that).
 */
import { useSyncExternalStore } from 'react';
import { cardDeal, cardPlay } from './cardSounds';

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
// Audio debug log (hidden: tap the build line on the home screen five times). Records what iOS does with audio when
// the page leaves the screen and comes back, so a delay on a real phone can be diagnosed.
const audioLog: string[] = [];
const logListeners = new Set<() => void>();
let logSnapshot: readonly string[] = [];
let lastLine = '';
let repeat = 0;
export function alog(msg: string) {
  const now = (performance.now() / 1000).toFixed(1);
  if (msg === lastLine) {
    repeat++;
    audioLog[audioLog.length - 1] = `${now} ${msg} ×${repeat + 1}`;
  } else {
    lastLine = msg;
    repeat = 0;
    audioLog.push(`${now} ${msg}`);
    if (audioLog.length > 60) audioLog.shift();
  }
  logSnapshot = [...audioLog];
  for (const fn of logListeners) fn();
}
export function useAudioLog(): readonly string[] {
  return useSyncExternalStore(
    (fn) => {
      logListeners.add(fn);
      return () => logListeners.delete(fn);
    },
    () => logSnapshot,
  );
}
let inTap = false;
let playedSinceVisible = false;

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
      alog('new context failed');
      return null;
    }
    const made = ctx;
    alog(`new context (${inTap ? 'tap' : 'no tap'}) → ${made.state}`);
    made.onstatechange = () => alog(`state → ${made.state}`);
    scheduleIdle();
  }
  // 'suspended' after autoplay blocking, 'interrupted' (Safari) after the page was in the background
  if (ctx.state !== 'running' && ctx.state !== 'closed') {
    // Ask again on every call, never just wait on an earlier request: iOS leaves a resume asked for outside a tap
    // pending forever, and only a resume called inside a tap goes through.
    const a = ctx;
    const asked = performance.now();
    alog(`resume asked (${inTap ? 'tap' : 'no tap'}, ${a.state})`);
    const r: Promise<void> = a
      .resume()
      .then(
        () => alog(`resume done ${Math.round(performance.now() - asked)} ms → ${a.state}`),
        (e) => alog(`resume failed: ${(e as Error)?.name ?? e}`),
      )
      .finally(() => {
        if (resuming === r) resuming = null;
      });
    resuming = r;
    scheduleIdle();
  }
  return ctx;
}

/** Set when the context says it's running but its clock is stuck: it's replaced at the next tap. */
let stale = false;

/**
 * After returning to the page, iOS holds the audio for a few seconds (or until a tap): the context reports 'running'
 * with its clock frozen, or stays 'suspended' with resume requests left waiting. Keep asking until the clock really
 * moves, so sound is back the moment iOS lets go, not at the next sound after that. If it's still stuck, the next tap
 * replaces the context (only a tap may start a new one).
 */
let reviveTimer: ReturnType<typeof setInterval> | null = null;
function revive() {
  if (reviveTimer) clearInterval(reviveTimer);
  const started = performance.now();
  let last = ctx?.currentTime ?? -1;
  const stop = () => {
    if (reviveTimer) clearInterval(reviveTimer);
    reviveTimer = null;
  };
  reviveTimer = setInterval(() => {
    const a = ctx;
    if (!a || document.visibilityState !== 'visible' || performance.now() - started > 20000) return stop();
    if (a.state === 'running' && a.currentTime !== last) {
      alog('clock moving');
      stale = false;
      return stop();
    }
    last = a.currentTime;
    if (a.state !== 'running') audio(); // asks to resume
    else if (!stale && performance.now() - started > 300) {
      stale = true;
      alog('clock stuck → new context at next tap');
    }
  }, 250);
}

if (typeof window !== 'undefined') {
  // the iOS app calls this as it comes back to the foreground, after reactivating its audio (MainViewController.swift)
  (window as unknown as { __shengjiAudioNudge?: () => void }).__shengjiAudioNudge = () => {
    alog('app active (native)');
    audio();
    revive();
  };
}

// Unlock audio on interaction. Not just the first one: phones suspend audio whenever the page leaves the screen,
// and a tap is always allowed to start it again.
if (typeof window !== 'undefined') {
  const unlock = () => {
    inTap = true;
    setTimeout(() => (inTap = false));
    if (stale && ctx) {
      // inside a tap, so the new context is allowed to start
      stale = false;
      void ctx.close().catch(() => {});
      ctx = null;
      noise = null;
      idleSuspended = false;
    }
    audio();
  };
  window.addEventListener('pointerdown', unlock);
  // iOS only lets audio start on a touch's end or a click, not on its start
  window.addEventListener('touchend', unlock);
  window.addEventListener('click', unlock);
  window.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', () => {
    alog(`page ${document.visibilityState} (${ctx?.state ?? 'no context'})`);
    playedSinceVisible = false;
    if (document.visibilityState === 'hidden') {
      // Leave the context alone: iOS interrupts it in the background and brings an interrupted context back by itself
      // when we return. One we suspend (or a new one) only starts again from a tap — the audio log on a phone showed
      // every resume asked for without a tap staying 'suspended' until the next touch.
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
    } else {
      audio();
      revive();
    }
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
  if (!a) return;
  const go = () => {
    if (!playedSinceVisible) {
      playedSinceVisible = true;
      alog('sound played');
    }
    const out = a.createGain();
    out.gain.value = volume;
    out.connect(a.destination);
    build(a, out, a.currentTime + 0.005);
    scheduleIdle();
  };
  if (a.state === 'running') return go();
  // suspended by us for battery: play once it's back, unless that took so long the sound would be late
  if (!idleSuspended || !resuming) return alog(`sound dropped (${a.state})`);
  const asked = performance.now();
  void resuming.then(() => {
    if (a === ctx && a.state === 'running' && performance.now() - asked < 250) {
      idleSuspended = false;
      go();
    } else alog(`sound dropped (late, ${a.state})`);
  });
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
  /** A card played: a swish and a light tap (see cardSounds.ts). */
  card() {
    play((a, out, t) => cardPlay(a, out, noiseBuffer(a), t), MASTER * 0.7);
  },
  /** A card flicked across the table while dealing: quieter than a play, since a deal is a hundred of them. */
  deal() {
    play((a, out, t) => cardDeal(a, out, noiseBuffer(a), t), MASTER * 0.4);
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
