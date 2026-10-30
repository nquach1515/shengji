export type Suit = 'S' | 'H' | 'D' | 'C';
export type CardSuit = Suit | 'J';

/** rank: 2..14 (14 = Ace); jokers use 15 (small) and 16 (big). */
export interface Card {
  id: string;
  suit: CardSuit;
  rank: number;
}

export const SUITS: Suit[] = ['S', 'H', 'C', 'D'];
export const SMALL_JOKER = 15;
export const BIG_JOKER = 16;

export const SUIT_GLYPH: Record<CardSuit, string> = { S: '♠', H: '♥', D: '♦', C: '♣', J: '★' };
export const SUIT_NAME: Record<CardSuit, string> = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs', J: 'Jokers' };

export function rankLabel(rank: number): string {
  if (rank <= 10) return String(rank);
  return ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: 'Joker', 16: 'Joker' } as Record<number, string>)[rank];
}

export function isRed(card: Card): boolean {
  return card.suit === 'H' || card.suit === 'D' || (card.suit === 'J' && card.rank === BIG_JOKER);
}

/** Two cards are "identical" (can form a pair) when suit and rank match. */
export function cardKey(card: Card): string {
  return `${card.suit}${card.rank}`;
}

export function points(card: Card): number {
  if (card.rank === 5) return 5;
  if (card.rank === 10 || card.rank === 13) return 10;
  return 0;
}

export function totalPoints(cards: Card[]): number {
  return cards.reduce((s, c) => s + points(c), 0);
}

export function makeDecks(count: number): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < count; d++) {
    for (const suit of SUITS) {
      for (let rank = 2; rank <= 14; rank++) cards.push({ id: `${d}${suit}${rank}`, suit, rank });
    }
    cards.push({ id: `${d}J15`, suit: 'J', rank: SMALL_JOKER });
    cards.push({ id: `${d}J16`, suit: 'J', rank: BIG_JOKER });
  }
  return cards;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  const rand = new Uint32Array(a.length);
  crypto.getRandomValues(rand);
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand[i] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function levelLabel(level: number): string {
  return rankLabel(Math.min(level, 14));
}
