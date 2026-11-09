/*
 * iOS app sound: WebKit holds web audio for several seconds after the app comes back from the background (until a tap
 * or until iOS lets go), so the app renders each sound once with OfflineAudioContext — which needs no audio output —
 * and plays it through the native NativeSound plugin (ios/App/App/MainViewController.swift), which isn't held.
 * Loaded only in the app (main.tsx). If the installed app has no NativeSound plugin, sounds use web audio as before.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { renderSound, setNativePlayer, SOUNDS, type SoundName, useWebAudio } from './sound';

interface NativeSoundPlugin {
  load(o: { sounds: Record<string, string[]> }): Promise<void>;
  play(o: { name: string }): Promise<void>;
}
const NativeSound = registerPlugin<NativeSoundPlugin>('NativeSound');

const RATE = 44100;
/** Takes per sound: the card sounds use random noise, so a few takes keep a deal from sounding mechanical. */
const TAKES: Partial<Record<SoundName, number>> = { card: 4, deal: 4, sweep: 3 };

/** 16-bit mono WAV, base64. */
function wav(samples: Float32Array): string {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(bytes.buffer);
  const str = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function setupNativeSound() {
  if (!Capacitor.isPluginAvailable('NativeSound')) return useWebAudio();
  try {
    const sounds: Record<string, string[]> = {};
    for (const name of Object.keys(SOUNDS) as SoundName[]) {
      sounds[name] = [];
      for (let k = 0; k < (TAKES[name] ?? 1); k++) sounds[name].push(wav(await renderSound(name, RATE)));
    }
    await NativeSound.load({ sounds });
    setNativePlayer((name) => void NativeSound.play({ name }).catch(() => {}));
  } catch {
    useWebAudio();
  }
}
