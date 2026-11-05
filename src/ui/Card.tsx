import { CSSProperties } from 'react';
import { BIG_JOKER, Card, isRed, points, rankLabel, SUIT_GLYPH } from '../game/cards';

interface Props {
  card: Card;
  trump?: boolean;
  selected?: boolean;
  className?: string;
  style?: CSSProperties;
}

// Pip positions (x, y as % of the pip area) for number cards, like a traditional deck.
const L = 22;
const C = 50;
const R = 78;
const PIPS: Record<number, [number, number][]> = {
  2: [[C, 8], [C, 92]],
  3: [[C, 8], [C, 50], [C, 92]],
  4: [[L, 8], [R, 8], [L, 92], [R, 92]],
  5: [[L, 8], [R, 8], [C, 50], [L, 92], [R, 92]],
  6: [[L, 8], [R, 8], [L, 50], [R, 50], [L, 92], [R, 92]],
  7: [[L, 8], [R, 8], [C, 29], [L, 50], [R, 50], [L, 92], [R, 92]],
  8: [[L, 8], [R, 8], [C, 29], [L, 50], [R, 50], [C, 71], [L, 92], [R, 92]],
  9: [[L, 8], [R, 8], [L, 36], [R, 36], [C, 50], [L, 64], [R, 64], [L, 92], [R, 92]],
  10: [[L, 8], [R, 8], [C, 22], [L, 36], [R, 36], [L, 64], [R, 64], [C, 78], [L, 92], [R, 92]],
};
const COURT_ZH: Record<number, string> = { 11: '侍', 12: '后', 13: '王' };

export function CardFace({ card, trump, selected, className = '', style }: Props) {
  // suit-X lets the four-colour option recolour diamonds and clubs
  const cls = ['card', isRed(card) ? 'red' : '', `suit-${card.suit}`, selected ? 'selected' : '', className];
  const pts = points(card);
  if (card.suit === 'J') {
    const big = card.rank === BIG_JOKER;
    return (
      <div className={[...cls, 'joker', big ? 'big' : 'small'].join(' ')} style={style}>
        <div className="joker-text">
          {'JOKER'.split('').map((ch, i) => (
            <span key={i}>{ch}</span>
          ))}
        </div>
        <div className="jart">
          <span className="star">★</span>
          <span className="zh">{big ? '大' : '小'}</span>
        </div>
      </div>
    );
  }
  const glyph = SUIT_GLYPH[card.suit];
  const label = rankLabel(card.rank);
  let center: JSX.Element;
  if (card.rank === 14) {
    center = (
      <div className="ace">
        <div className="ring">{glyph}</div>
      </div>
    );
  } else if (card.rank >= 11) {
    center = (
      <div className="court">
        <span className="big">{label}</span>
        <span className="zh">{COURT_ZH[card.rank]}</span>
        <span className="st">{glyph}</span>
      </div>
    );
  } else {
    center = (
      <div className="pips">
        {PIPS[card.rank].map(([x, y], i) => (
          <span key={i} className={y > 55 ? 'flip' : ''} style={{ left: `${x}%`, top: `${y}%` }}>
            {glyph}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className={cls.join(' ')} style={style}>
      <div className="corner">
        <span className="r">{label}</span>
        <span className="s">{glyph}</span>
      </div>
      {center}
      {card.rank !== 14 && <div className="jumbo">{glyph}</div>}
      <div className="corner br">
        <span className="r">{label}</span>
        <span className="s">{glyph}</span>
      </div>
      {trump && <div className="zhu">主</div>}
      {pts > 0 && <div className="coin">{pts}</div>}
    </div>
  );
}

export function CardBack({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <div className={`card back ${className}`} style={style} />;
}
