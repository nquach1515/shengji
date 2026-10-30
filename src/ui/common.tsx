import { SeatView } from '../net/protocol';

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

export function copyText(text: string): Promise<boolean> {
  return navigator.clipboard
    .writeText(text)
    .then(() => true)
    .catch(() => false);
}
