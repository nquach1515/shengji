/*
 * iOS app self-update. Every `npm run build` writes app/version.json and a zip of the game next to the site, so the
 * usual `npx wrangler deploy` also publishes an update for the app. The app checks once per launch, downloads a new
 * version quietly, and switches to it on the NEXT launch, before anything is on screen, so a game in progress is
 * never reloaded. (The plugin's own `next()` would also switch when the app is backgrounded, mid-game.)
 *
 * Loaded only inside the app (dynamic import in main.tsx), so the website never downloads this or the plugin.
 */
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { SITE_DOMAIN } from './site';


// VITE_UPDATE_SITE points a test build at a local server instead of the live site
const SITE: string = import.meta.env.VITE_UPDATE_SITE ?? `https://${SITE_DOMAIN}/`;
const PENDING = 'shengji.update.pending'; // { id, version }: downloaded, switch to it on next launch
const APPLYING = 'shengji.update.applying'; // version we just switched to; if we're not running it, it failed
const BAD = 'shengji.update.bad'; // version that failed to start (the plugin rolled back); don't fetch it again

interface VersionFile {
  id: string; // build id
  native: number; // native app level this build needs (package.json iosNativeLevel)
  zip: string; // path of the bundle zip, relative to the site
  sha256: string; // of the zip; the plugin checks the download against it
}

function get<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function put(key: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable: worst case we re-download or skip an update */
  }
}

/** Call before rendering: switches to an update downloaded on an earlier launch (the page reloads into it). */
export async function applyPendingUpdate(): Promise<void> {
  const applying = get<string>(APPLYING);
  if (applying && applying !== __BUILD_ID__) {
    put(APPLYING, null);
    put(BAD, applying); // we switched but came back up on another version: it failed and the plugin rolled back
  }
  const pending = get<{ id: string; version: string }>(PENDING);
  if (!pending) return;
  put(PENDING, null); // cleared first so a bad bundle can't cause a reload loop
  if (pending.version === __BUILD_ID__) return;
  try {
    const { bundles } = await CapacitorUpdater.list();
    if (!bundles.some((b) => b.id === pending.id && b.status !== 'error')) return;
    put(APPLYING, pending.version);
    await CapacitorUpdater.set({ id: pending.id }); // reloads; nothing after this runs
  } catch (e) {
    put(APPLYING, null);
    console.warn('update: could not apply', e);
  }
}

/** Call after the app is up: confirms this version works, then looks for a newer one to download. */
export async function checkForUpdate(): Promise<void> {
  try {
    await CapacitorUpdater.notifyAppReady(); // without this within 10 s the plugin rolls back to the previous version
    put(APPLYING, null); // this version started fine
    const res = await fetch(`${SITE}app/version.json`, { cache: 'no-store' });
    if (!res.ok) return;
    const latest = (await res.json()) as VersionFile;
    const { bundles } = await CapacitorUpdater.list();
    const { bundle: current } = await CapacitorUpdater.current();
    // tidy up downloads that a later deploy has superseded
    for (const b of bundles) {
      if (b.id !== current.id && b.version !== latest.id) await CapacitorUpdater.delete({ id: b.id }).catch(() => {});
    }
    if (latest.id === __BUILD_ID__ || latest.id === get<string>(BAD)) return;
    const installedNative = Number((await CapacitorUpdater.getBuiltinVersion()).version);
    if (!(latest.native <= installedNative)) return; // needs a newer app from the App Store
    const have = bundles.find((b) => b.version === latest.id && b.status !== 'error');
    const bundle = have ?? (await CapacitorUpdater.download({
        url: new URL(latest.zip, SITE).href,
        version: latest.id,
        checksum: latest.sha256,
      }));
    put(PENDING, { id: bundle.id, version: latest.id });
  } catch (e) {
    console.warn('update: check failed', e); // offline etc.: try again next launch
  }
}
