/*
 * The card sounds, as plain Web Audio graphs: kept apart from sound.ts (which needs the page) so they can also be
 * rendered offline to compare versions. Every sound varies slightly each time so a run of them doesn't sound like
 * one sample on repeat.
 */

const vary = (amount = 0.15) => 1 - amount + Math.random() * amount * 2;

/** Noise through a filter, with a sharp attack and an exponential decay. */
function noiseHit(
  a: BaseAudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  t: number,
  o: { type: BiquadFilterType; freq: number; q?: number; gain: number; attack?: number; decay: number },
) {
  const src = a.createBufferSource();
  src.buffer = noise;
  const f = a.createBiquadFilter();
  f.type = o.type;
  f.frequency.value = o.freq;
  f.Q.value = o.q ?? 0.7;
  const g = a.createGain();
  const attack = o.attack ?? 0.001;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0005, t + attack + o.decay);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 0.4);
  src.stop(t + attack + o.decay + 0.02);
}

/** Filtered noise whose pitch glides from `from` to `to`, fading out over `dur`. */
function swish(a: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t: number, o: { from: number; to: number; dur: number; gain: number; q: number }) {
  const src = a.createBufferSource();
  src.buffer = noise;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = o.q;
  f.frequency.setValueAtTime(o.from, t);
  f.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0005, t);
  g.gain.linearRampToValueAtTime(o.gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0005, t + o.dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 0.4);
  src.stop(t + o.dur + 0.03);
}

/**
 * A card played: the deal sound in reverse — a quick downward swish as the card slides out of the hand, then a
 * light tap as it lands.
 */
export function cardPlay(a: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t: number) {
  const d = 0.05 * vary();
  swish(a, out, noise, t, { from: 4200 * vary(), to: 1500 * vary(), dur: d, gain: 0.26 * vary(), q: 1.4 });
  noiseHit(a, out, noise, t + d * 0.8, { type: 'highpass', freq: 2300 * vary(), gain: 0.32 * vary(), decay: 0.014 }); // tap
  noiseHit(a, out, noise, t + d * 0.8, { type: 'lowpass', freq: 280 * vary(), gain: 0.45 * vary(), attack: 0.002, decay: 0.05 }); // soft thud
}

/**
 * A card flicked across the table while dealing: a "fwip" that rises in pitch and swells until the card lands,
 * then a light tick.
 */
export function cardDeal(a: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t: number) {
  const dur = 0.075 * vary();
  const src = a.createBufferSource();
  src.buffer = noise;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 1.6;
  f.frequency.setValueAtTime(1400 * vary(), t);
  f.frequency.exponentialRampToValueAtTime(5200 * vary(), t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0005, t);
  g.gain.exponentialRampToValueAtTime(0.32 * vary(), t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.006);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 0.4);
  src.stop(t + dur + 0.02);
  noiseHit(a, out, noise, t + dur, { type: 'highpass', freq: 2500 * vary(), gain: 0.3 * vary(), decay: 0.015 }); // landing tick
  noiseHit(a, out, noise, t + dur, { type: 'lowpass', freq: 300, gain: 0.25 * vary(), attack: 0.002, decay: 0.035 }); // soft touch
}
