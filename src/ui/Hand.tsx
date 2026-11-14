import { AnimatePresence } from 'framer-motion';
import { motion, settle } from './motion';
import { memo, PointerEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Card } from '../game/cards';
import { effSuit, isTrump, TrumpCtx } from '../game/rules';
import { CardFace } from './Card';
import { PHONE_W, useStage } from './stage';

function useWidth(ref: React.RefObject<HTMLElement>) {
  const [w, setW] = useState(800);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function cardWidth(stageW: number) {
  return stageW <= PHONE_W ? 52 : Math.min(96, Math.max(54, stageW * 0.06));
}

interface Props {
  cards: Card[];
  ctx: TrumpCtx;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** cards that arrive while true fly in from the deck */
  dealing: boolean;
}

export function Hand({ cards, ctx, selected, onChange, dealing }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const stage = useStage();
  const cw = cardWidth(stage.w);
  const ch = cw * 1.4;

  // Layout: group by effective suit with small gaps; wrap into two (or, with 3 decks, three) rows when the fan gets too tight.
  const n = cards.length;
  const groupGap = cw * 0.2;
  const layoutRow = (row: Card[]) => {
    let groups = 0;
    const groupIdx: number[] = [];
    row.forEach((c, i) => {
      if (i > 0 && effSuit(c, ctx) !== effSuit(row[i - 1], ctx)) groups++;
      groupIdx.push(groups);
    });
    const step = Math.min(cw * 0.8, (width - cw - groups * groupGap) / Math.max(1, row.length - 1));
    const total = cw + step * (row.length - 1) + groups * groupGap;
    const start = (width - total) / 2;
    return row.map((_, i) => start + i * step + groupIdx[i] * groupGap);
  };
  const rowStep = (count: number) => (width - cw - 4 * groupGap) / Math.max(1, Math.ceil(n / count) - 1);
  // three rows only for 3-deck hands (a 2-deck hand is at most 33 cards)
  const rowCount = n <= 14 || rowStep(1) >= cw * 0.3 ? 1 : n <= 40 || rowStep(2) >= cw * 0.24 ? 2 : 3;
  const twoRows = rowCount > 1;
  const perRow = Math.ceil(n / rowCount);
  const rows = Array.from({ length: rowCount }, (_, r) => cards.slice(r * perRow, (r + 1) * perRow));
  const lift = cw * 0.34;
  const rowOffset = ch * 0.52;
  const height = ch + (rows.length - 1) * rowOffset + lift + cw * 0.3;

  const placed: { card: Card; x: number; y: number; rotate: number; z: number }[] = [];
  rows.forEach((row, r) => {
    const xs = layoutRow(row);
    const mid = (row.length - 1) / 2;
    const maxRot = twoRows ? 3 : Math.min(5, row.length * 0.25);
    row.forEach((card, i) => {
      const t = mid === 0 ? 0 : (i - mid) / mid;
      placed.push({
        card,
        x: xs[i],
        y: lift + r * rowOffset + t * t * cw * 0.08,
        rotate: t * maxRot,
        z: r * 100 + i,
      });
    });
  });

  // Click or drag across cards to select/deselect.
  const drag = useRef<{ mode: 'add' | 'remove'; touched: Set<string> } | null>(null);
  const sel = useRef(selected);
  sel.current = selected;
  const idAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-card]')?.dataset.card;
  const apply = (id: string) => {
    const d = drag.current;
    if (!d || d.touched.has(id)) return;
    d.touched.add(id);
    const next = new Set(sel.current);
    if (d.mode === 'add') next.add(id);
    else next.delete(id);
    onChange(next);
  };
  const onDown = (e: PointerEvent) => {
    const id = idAt(e.clientX, e.clientY);
    if (!id) return;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    drag.current = { mode: sel.current.has(id) ? 'remove' : 'add', touched: new Set() };
    apply(id);
  };
  const onMove = (e: PointerEvent) => {
    if (!drag.current) return;
    const id = idAt(e.clientX, e.clientY);
    if (id) apply(id);
  };
  useEffect(() => {
    const up = () => (drag.current = null);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="hand"
      style={{ height, ['--cw' as string]: `${cw}px` }}
      onPointerDown={onDown}
      onPointerMove={onMove}
    >
      <AnimatePresence initial={false}>
        {placed.map(({ card, x, y, rotate, z }) => {
          const isSel = selected.has(card.id);
          const ty = isSel ? y - lift : y;
          return (
            <Slot
              key={card.id}
              card={card}
              x={x}
              y={ty}
              rotate={rotate}
              z={z}
              selected={isSel}
              trump={isTrump(card, ctx)}
              from={
                dealing
                  ? { x: width / 2 - cw / 2, y: -stage.h * 0.45, rotate: 160, opacity: 0, scale: 0.7 }
                  : { x, y: ty + 40, rotate, opacity: 0 }
              }
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
}

interface SlotProps {
  card: Card;
  x: number;
  y: number;
  rotate: number;
  z: number;
  selected: boolean;
  trump: boolean;
  /** where the card animates in from; only used when it first appears */
  from: { x: number; y: number; rotate: number; opacity: number; scale?: number };
}

/**
 * One card in the hand. Memoized on what it shows and where it sits, so a tap re-renders only the card tapped, and a
 * new card dealt in re-renders only the cards that move (with 3 decks a hand is up to 38 cards).
 */
const Slot = memo(
  function Slot({ card, x, y, rotate, z, selected, trump, from }: SlotProps) {
    return (
      <motion.div
        data-card={card.id}
        className="slot"
        style={{ zIndex: z }}
        initial={from}
        animate={{ x, y, rotate, opacity: 1, scale: 1 }}
        exit={{ y: y - 140, opacity: 0, scale: 0.85, transition: { duration: 0.25 } }}
        transition={settle({ type: 'spring', stiffness: 420, damping: 34, mass: 0.8 })}
      >
        <div className={`lift ${selected ? 'sel' : ''}`}>
          <CardFace card={card} trump={trump} selected={selected} />
        </div>
      </motion.div>
    );
  },
  // `from` only matters on the first render, and the card is the same card while its id is
  (a, b) =>
    a.card.id === b.card.id && a.x === b.x && a.y === b.y && a.rotate === b.rotate && a.z === b.z && a.selected === b.selected && a.trump === b.trump,
);
