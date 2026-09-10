import pokersolver from 'pokersolver';
import type { CardStr } from '@th/shared';

const { Hand } = pokersolver;

export interface EvaluatedHand {
  /** pokersolver 内部对象，用于比较胜负 */
  solved: pokersolver.SolvedHand;
  /** 中文牌型名 */
  handName: string;
}

const HAND_NAMES: Record<string, string> = {
  'Straight Flush': '同花顺',
  'Royal Flush': '皇家同花顺',
  'Four of a Kind': '四条',
  'Full House': '葫芦',
  Flush: '同花',
  Straight: '顺子',
  'Three of a Kind': '三条',
  'Two Pair': '两对',
  'One Pair': '一对',
  'High Card': '高牌',
};

/** 评估 7 张牌（2 底牌 + 5 公共牌）的最佳组合 */
export function evaluate7(cards: CardStr[]): EvaluatedHand {
  if (cards.length !== 7) throw new Error(`需要 7 张牌，收到 ${cards.length}`);
  const solved = Hand.solve(cards);
  let name = HAND_NAMES[solved.name] ?? solved.name;
  // pokersolver 把皇家同花顺归为 Straight Flush，descr 中以 "Royal Flush" 描述
  if (solved.name === 'Straight Flush' && /royal/i.test(solved.descr ?? '')) {
    name = '皇家同花顺';
  }
  return { solved, handName: name };
}

/**
 * 在给定座位中找出赢家（支持平分）。
 * @param entries seatIndex -> 7 张牌
 * @returns 赢家座位列表
 */
export function pickWinners(entries: Map<number, EvaluatedHand>): number[] {
  const seats = [...entries.keys()];
  const hands = seats.map((s) => entries.get(s)!.solved);
  const winners = Hand.winners(hands);
  const winnerSet = new Set(winners);
  return seats.filter((s, i) => winnerSet.has(hands[i]));
}
