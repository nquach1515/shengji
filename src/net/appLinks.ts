/*
 * iOS app: invite links (https://shengji-tractor.com/join/CODE, or the older /?room=CODE) open the app when it's installed (Universal Links;
 * see site/worker.js and ios/App/App/App.entitlements). The room is put in our own URL, where the home screen looks
 * for it, so the app shows the same "join this table" screen the site does. Loaded only in the app.
 */
import { App } from '@capacitor/app';

function roomFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const code = /^\/join\/([a-z]{4})\/?$/i.exec(u.pathname)?.[1] ?? u.searchParams.get('room');
    return code && /^[a-z]{4}$/i.test(code) ? code.toUpperCase() : null;
  } catch {
    return null;
  }
}

export function putRoomInUrl(room: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('room', room);
  window.history.replaceState(null, '', url);
}

/** Before the first render: if an invite link launched the app, open on that invite. */
export async function applyLaunchLink() {
  const launch = await App.getLaunchUrl().catch(() => undefined);
  const room = launch?.url ? roomFromUrl(launch.url) : null;
  if (room) putRoomInUrl(room);
}

/** Invite links tapped while the app is already running. */
export function onInviteLink(fn: (room: string) => void) {
  void App.addListener('appUrlOpen', ({ url }) => {
    const room = roomFromUrl(url);
    if (room) fn(room);
  });
}
