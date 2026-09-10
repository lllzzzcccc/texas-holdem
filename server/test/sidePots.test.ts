import { describe, it, expect } from 'vitest';
import { buildPots, splitPot } from '../src/engine/sidePots.js';

describe('buildPots 边池构建', () => {
  it('无 all-in 时只有一个主池', () => {
    const pots = buildPots([
      { seatIndex: 0, amount: 100, folded: false },
      { seatIndex: 1, amount: 100, folded: false },
    ]);
    expect(pots).toEqual([{ amount: 200, eligibleSeats: [0, 1] }]);
  });

  it('短筹码 all-in 产生边池', () => {
    const pots = buildPots([
      { seatIndex: 0, amount: 100, folded: false },
      { seatIndex: 1, amount: 200, folded: false },
      { seatIndex: 2, amount: 200, folded: false },
    ]);
    expect(pots).toEqual([
      { amount: 300, eligibleSeats: [0, 1, 2] },
      { amount: 200, eligibleSeats: [1, 2] },
    ]);
  });

  it('弃牌玩家的死钱计入池但不具备资格', () => {
    const pots = buildPots([
      { seatIndex: 0, amount: 100, folded: true },
      { seatIndex: 1, amount: 100, folded: false },
      { seatIndex: 2, amount: 50, folded: false },
    ]);
    expect(pots).toEqual([
      { amount: 150, eligibleSeats: [1, 2] },
      { amount: 100, eligibleSeats: [1] },
    ]);
  });

  it('嵌套三层边池', () => {
    const pots = buildPots([
      { seatIndex: 0, amount: 50, folded: false },
      { seatIndex: 1, amount: 150, folded: false },
      { seatIndex: 2, amount: 300, folded: false },
      { seatIndex: 3, amount: 300, folded: false },
    ]);
    expect(pots).toEqual([
      { amount: 200, eligibleSeats: [0, 1, 2, 3] },
      { amount: 300, eligibleSeats: [1, 2, 3] },
      { amount: 300, eligibleSeats: [2, 3] },
    ]);
  });

  it('eligible 相同的相邻层合并', () => {
    const pots = buildPots([
      { seatIndex: 0, amount: 100, folded: false },
      { seatIndex: 1, amount: 100, folded: false },
      { seatIndex: 2, amount: 80, folded: true },
    ]);
    // 层1: 80*3=240 eligible {0,1}；层2: 20*2=40 eligible {0,1} → 合并 280
    expect(pots).toEqual([{ amount: 280, eligibleSeats: [0, 1] }]);
  });
});

describe('splitPot 分池', () => {
  it('单赢家全得', () => {
    const m = splitPot(200, [3], 0);
    expect(m.get(3)).toBe(200);
  });

  it('平分偶数池', () => {
    const m = splitPot(100, [1, 2], 0);
    expect(m.get(1)).toBe(50);
    expect(m.get(2)).toBe(50);
  });

  it('奇数筹码给 dealer 顺时针方向最近的赢家', () => {
    // 101 平分给 [3,5]，dealer=4 → 4 之后最近的是 5 → 5 多得 1
    const m = splitPot(101, [3, 5], 4);
    expect(m.get(5)).toBe(51);
    expect(m.get(3)).toBe(50);
  });

  it('绕环情形：dealer 之后无赢家则给最小座位号赢家', () => {
    const m = splitPot(101, [1, 3], 4);
    expect(m.get(1)).toBe(51);
    expect(m.get(3)).toBe(50);
  });
});
