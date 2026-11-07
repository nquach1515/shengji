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

/**
 * A card slapped down on the felt: a crisp papery crack, the card's face flapping flat, a soft thud from the table
 * underneath, and a faint second tick as it settles.
 */
export function cardPlay(a: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t: number) {
  noiseHit(a, out, noise, t, { type: 'highpass', freq: 2200 * vary(), q: 0.8, gain: 0.55 * vary(), decay: 0.022 * vary() }); // crack
  noiseHit(a, out, noise, t + 0.002, { type: 'bandpass', freq: 1300 * vary(), q: 1.3, gain: 0.45 * vary(), attack: 0.002, decay: 0.06 * vary() }); // flap
  noiseHit(a, out, noise, t, { type: 'lowpass', freq: 260 * vary(), q: 0.9, gain: 0.7 * vary(), attack: 0.002, decay: 0.07 }); // thud
  noiseHit(a, out, noise, t + 0.014 * vary(0.3), { type: 'highpass', freq: 3500, gain: 0.12 * vary(), decay: 0.01 }); // settle
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
