import { randomInt } from 'node:crypto';
import type { CardStr } from '@th/shared';

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
export const SUITS = ['s', 'h', 'd', 'c'] as const;

export function rankValue(card: CardStr): number {
  return RANKS.indexOf(card[0] as (typeof RANKS)[number]);
}

export function suitValue(card: CardStr): number {
  return SUITS.indexOf(card[1] as (typeof SUITS)[number]);
}

/** 抽牌比大小：先比点数，再按桥牌花色序 ♠>♥>♦>♣ */
export function compareHighCard(a: CardStr, b: CardStr): number {
  const rv = rankValue(a) - rankValue(b);
  if (rv !== 0) return rv;
  // SUITS 顺序 s,h,d,c 恰好索引越小越大
  return suitValue(b) - suitValue(a);
}

export class Deck {
  private cards: CardStr[];

  /**
   * @param preset 测试用：指定牌堆（draw 从头部取牌）。不传则洗一副新牌。
   */
  constructor(preset?: CardStr[]) {
    if (preset) {
      this.cards = [...preset];
    } else {
      this.cards = [];
      for (const r of RANKS) for (const s of SUITS) this.cards.push(`${r}${s}`);
      // Fisher–Yates，使用 crypto 随机源
      for (let i = this.cards.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
      }
    }
  }

  draw(): CardStr {
    const c = this.cards.shift();
    if (!c) throw new Error('牌堆已空');
    return c;
  }

  get remaining(): number {
    return this.cards.length;
  }
}
