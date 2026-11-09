/**
 * Hidden audio debug panel: tap the build line on the home screen five times to show or hide it. Lists what happened to
 * the sound (page hidden/shown, iOS audio states, resume requests and how long they took, dropped sounds), for
 * diagnosing sound problems on a real phone.
 */
import { useSyncExternalStore } from 'react';
import { useAudioLog } from './sound';

const KEY = 'sj-audio-log';
const listeners = new Set<() => void>();
let open = (() => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
})();

export function toggleAudioLog() {
  open = !open;
  try {
    localStorage.setItem(KEY, open ? '1' : '0');
  } catch {
    /* ignore */
  }
  for (const fn of listeners) fn();
}

let taps: number[] = [];
/** Five taps within three seconds toggle the panel. */
export function tapForAudioLog() {
  const now = Date.now();
  taps = [...taps.filter((t) => now - t < 3000), now];
  if (taps.length >= 5) {
    taps = [];
    toggleAudioLog();
  }
}

export function AudioLog() {
  const shown = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => open,
  );
  const lines = useAudioLog();
  if (!shown) return null;
  return (
    <div className="audio-log">
      <div className="audio-log-head">
        <b>Audio log</b> · {__BUILD_SHA__}
        <button onClick={toggleAudioLog}>close</button>
      </div>
      {lines.length ? lines.slice(-24).map((l, i) => <div key={i}>{l}</div>) : <div>(nothing yet)</div>}
    </div>
  );
}
