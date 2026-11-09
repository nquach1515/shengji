/*
 * Light haptics in the iOS app (@capacitor/haptics); nothing on the website. Kept subtle: a tick when a card is
 * picked, a tap when you play, a short double tap when your turn starts, a success buzz when your team takes points.
 * Older app builds without the plugin simply get none. iPhone's own vibration setting still applies.
 */
import { IN_APP } from '../net/site';

type HapticsModule = typeof import('@capacitor/haptics');
let mod: Promise<HapticsModule | null> | null = null;

function load(): Promise<HapticsModule | null> | null {
  if (!IN_APP) return null;
  mod ??= Promise.all([import('@capacitor/haptics'), import('@capacitor/core')])
    .then(([h, core]) => (core.Capacitor.isPluginAvailable('Haptics') ? h : null))
    .catch(() => null);
  return mod;
}

function run(fn: (h: HapticsModule) => Promise<void>) {
  if (document.visibilityState === 'hidden') return;
  void load()?.then((h) => h && fn(h).catch(() => {}));
}

let lastTick = 0;

export const haptic = {
  /** A card picked or put back (rate-limited, so dragging across cards stays a light patter). */
  select() {
    const now = performance.now();
    if (now - lastTick < 40) return;
    lastTick = now;
    run((h) => h.Haptics.impact({ style: h.ImpactStyle.Light }));
  },
  /** Your cards played (or the kitty buried). */
  play() {
    run((h) => h.Haptics.impact({ style: h.ImpactStyle.Medium }));
  },
  /** Your turn: two light taps. */
  turn() {
    run(async (h) => {
      await h.Haptics.impact({ style: h.ImpactStyle.Light });
      setTimeout(() => void h.Haptics.impact({ style: h.ImpactStyle.Light }).catch(() => {}), 110);
    });
  },
  /** Your team took points. */
  points() {
    run((h) => h.Haptics.notification({ type: h.NotificationType.Success }));
  },
};
