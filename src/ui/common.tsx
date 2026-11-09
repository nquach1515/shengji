import { SeatView } from '../net/protocol';
import { IN_APP } from '../net/site';

export type Pos = 'bottom' | 'right' | 'top' | 'left';
const POSITIONS: Pos[] = ['bottom', 'right', 'top', 'left'];

/** Where a seat sits on screen from the viewer's perspective (play order runs bottom → right → top → left). */
export function posOf(seat: number, you: number | null): Pos {
  return POSITIONS[(seat - (you ?? 0) + 4) % 4];
}

export function sideOf(seat: number, you: number | null): 'us' | 'them' {
  return seat % 2 === (you ?? 0) % 2 ? 'us' : 'them';
}

/** Offset (px) from the table's center toward a seat, for a table of size w × h. */
export function towards(pos: Pos, w: number, h: number, frac: number): { x: number; y: number } {
  switch (pos) {
    case 'bottom':
      return { x: 0, y: (h / 2) * frac };
    case 'top':
      return { x: 0, y: (-h / 2) * frac };
    case 'left':
      return { x: (-w / 2) * frac, y: 0 };
    case 'right':
      return { x: (w / 2) * frac, y: 0 };
  }
}

export function Avatar({
  seat,
  size,
  side,
  dealer,
}: {
  seat: Pick<SeatView, 'name' | 'online'>;
  size?: number;
  side: 'us' | 'them';
  dealer?: boolean;
}) {
  return (
    <div
      className={`avatar ${side} ${seat.online ? '' : 'offline'}`}
      style={size ? { ['--size' as string]: `${size}px` } : undefined}
    >
      {seat.name.slice(0, 1).toUpperCase()}
      {dealer && (
        <span className="zhuang" title="Dealer">
          庄
        </span>
      )}
    </div>
  );
}

/** Phones, tablets and the iOS app share invite links through the system share sheet; computers copy them. */
export const SHARE_INVITES =
  IN_APP || (typeof navigator !== 'undefined' && !!navigator.share && matchMedia('(pointer: coarse)').matches);

/**
 * Opens the share sheet for an invite link (Messages, WhatsApp, AirDrop, Copy…), or copies it where there's no
 * share sheet. In the app it uses the native share plugin (when the installed app has it), since web share isn't
 * dependable inside an app's web view. Resolves 'copied' only when the link went to the clipboard.
 */
export async function shareInvite(code: string, url: string): Promise<'shared' | 'copied' | 'none'> {
  const data = { title: 'Join my Shengji table', text: `Join my Shengji table (code ${code})`, url };
  if (IN_APP) {
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isPluginAvailable('Share')) {
        const { Share } = await import('@capacitor/share');
        await Share.share({ ...data, dialogTitle: 'Invite to the table' });
        return 'shared';
      }
    } catch {
      return 'none'; // closed without sharing
    }
  }
  if (SHARE_INVITES && navigator.share) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'none';
    }
  }
  return (await copyText(url)) ? 'copied' : 'none';
}

export function copyText(text: string): Promise<boolean> {
  return navigator.clipboard
    .writeText(text)
    .then(() => true)
    .catch(() => false);
}
