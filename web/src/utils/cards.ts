import type { CardStr } from '@th/shared';

const SUIT_SYMBOLS: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANK_LABELS: Record<string, string> = {
  '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A',
};

export function rankLabel(card: CardStr): string {
  return RANK_LABELS[card[0]] ?? card[0];
}

export function suitSymbol(card: CardStr): string {
  return SUIT_SYMBOLS[card[1]] ?? card[1];
}

export function suitColor(card: CardStr): string {
  return card[1] === 'h' || card[1] === 'd' ? '#c0392b' : '#16213a';
}
