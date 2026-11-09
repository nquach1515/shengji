/*
 * Light haptics in the iOS app (@capacitor/haptics); nothing on the website. Kept subtle: a tick when a card is
 * picked, a tap when you play or declare trump, a light tap if your declaration is overturned, a short double tap when
 * your turn starts, a success buzz when your team takes points or wins the round, a soft warning when your throw is
 * blocked, and a light tap when a friend joins your table.
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
  /** A light tap: your trump declaration was overturned. */
  light() {
    run((h) => h.Haptics.impact({ style: h.ImpactStyle.Light }));
  },
  /** Your cards played, the kitty buried, or trump declared. */
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
  /** Something went wrong for you: your throw was blocked. iPhone's soft two-pulse warning. */
  warning() {
    run((h) => h.Haptics.notification({ type: h.NotificationType.Warning }));
  },
  /** Your team took points, or won the round. */
  points() {
    run((h) => h.Haptics.notification({ type: h.NotificationType.Success }));
  },
};
