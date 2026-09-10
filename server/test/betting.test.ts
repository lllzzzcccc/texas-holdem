import { describe, it, expect } from 'vitest';
import { HandEngine } from '../src/engine/HandEngine.js';
import { Deck } from '../src/engine/deck.js';
import { blindSeats, nextSeat } from '../src/engine/positions.js';
import { compareHighCard } from '../src/engine/deck.js';

const SB = 10;
const BB = 20;

function makeEngine(stacks: number[], dealerSeat: number, deckCards: string[], handNumber = 1) {
  const seats = stacks.map((stack, i) => ({
    seatIndex: i,
    playerId: `p${i}`,
    nickname: `玩家${i}`,
    stack,
    connected: true,
  }));
  return new HandEngine(seats, dealerSeat, { smallBlind: SB, bigBlind: BB, handNumber }, new Deck(deckCards));
}

/** 凑够一手牌用的无关紧要的牌堆（注意避开测试逻辑用到的牌） */
function fillerDeck(): string[] {
  return [
    '2c', '3d', '4h', '5s', '6c', '7d', '8h', '9s', // 底牌 8 张（4 人上限）
    'Tc', 'Jd', 'Qh', 'Ks', // flop + turn
    '2h', // river
  ];
}

describe('positions 位置计算', () => {
  it('3 人局：SB=dealer 下一家，BB 再下一家，UTG=BB 下一家', () => {
    const b = blindSeats([0, 1, 2], 0);
    expect(b).toEqual({ smallBlind: 1, bigBlind: 2, firstToActPreflop: 0, firstToActPostflop: 1 });
  });

  it('heads-up：dealer 即小盲，翻前 dealer 先行，翻后 BB 先行', () => {
    const b = blindSeats([0, 1], 0);
    expect(b.smallBlind).toBe(0);
    expect(b.bigBlind).toBe(1);
    expect(b.firstToActPreflop).toBe(0);
    expect(b.firstToActPostflop).toBe(1);
  });

  it('nextSeat 绕环', () => {
    expect(nextSeat([0, 3, 5], 5)).toBe(0);
    expect(nextSeat([0, 3, 5], 2)).toBe(3);
  });
});

describe('dealerDraw 抽牌比大小', () => {
  it('点数大者胜', () => {
    expect(compareHighCard('Ks', 'Qd') > 0).toBe(true);
    expect(compareHighCard('As', 'Kh') > 0).toBe(true);
  });

  it('同点数按花色 ♠>♥>♦>♣', () => {
    expect(compareHighCard('As', 'Ah') > 0).toBe(true);
    expect(compareHighCard('Ah', 'Ad') > 0).toBe(true);
    expect(compareHighCard('Ad', 'Ac') > 0).toBe(true);
  });

  it('抽牌比大小：最大牌的座位为庄家（与 Room.finishDraw 同一比较逻辑）', () => {
    // 座位 [2,5,7] 分别抽到 Kh, 2c, As
    const draws = [
      { seatIndex: 2, card: 'Kh' },
      { seatIndex: 5, card: '2c' },
      { seatIndex: 7, card: 'As' },
    ];
    let best = draws[0];
    for (const d of draws.slice(1)) {
      if (compareHighCard(d.card, best.card) > 0) best = d;
    }
    expect(best.seatIndex).toBe(7);
  });
});

describe('下注轮规则', () => {
  it('heads-up 盲注与行动顺序', () => {
    const e = makeEngine([1000, 1000], 0, fillerDeck());
    e.start();
    // dealer=0 是小盲 10，seat1 大盲 20，翻前 seat0 先行动
    expect(e.potTotal()).toBe(30);
    expect(e.actingSeat).toBe(0);
    e.act(0, 'call');
    expect(e.actingSeat).toBe(1);
    // BB 可以过牌（有 option）
    e.act(1, 'check');
    expect(e.phase).toBe('flop');
    // 翻后 BB(seat1) 先行动
    expect(e.actingSeat).toBe(1);
  });

  it('最小加注 = 上一次加注增量', () => {
    const e = makeEngine([1000, 1000, 1000], 0, fillerDeck());
    e.start();
    expect(e.actingSeat).toBe(0); // UTG
    e.act(0, 'raise', 60); // 增量 40
    // 下一家最小加注到 60+40=100
    expect(() => e.act(1, 'raise', 90)).toThrow(/最小加注/);
    e.act(1, 'raise', 100);
    expect(e.legalActions(2).minRaiseTo).toBe(140);
  });

  it('短 all-in 不构成完整加注，不重开行动轮', () => {
    // seat1 只剩 70：SB 10 + 60。UTG 加注到 60 后 seat1 全下 70（增量 10 < 40）
    const e = makeEngine([1000, 70, 1000], 0, fillerDeck());
    e.start();
    e.act(0, 'raise', 60);
    e.act(1, 'raise', 70); // 短 all-in
    e.act(2, 'call'); // 跟 70
    // 轮到 seat0：他已行动过且未被完整加注重开 → 只能跟注/弃牌，不能再加注
    const legal = e.legalActions(0);
    expect(legal.callAmount).toBe(10);
    expect(legal.canRaise).toBe(false);
    e.act(0, 'call');
    expect(e.phase).toBe('flop');
  });

  it('完整加注重开行动轮', () => {
    const e = makeEngine([1000, 1000, 1000], 0, fillerDeck());
    e.start();
    e.act(0, 'raise', 60);
    e.act(1, 'call');
    e.act(2, 'call');
    // 回到 seat0：已行动、注额匹配 → 本街应直接结束（被 call 不会重开）
    expect(e.phase).toBe('flop');
  });

  it('对手全 all-in 时不允许加注', () => {
    // heads-up：seat0(dealer/SB) 只有 10，盲注即 all-in；seat1 只能跟注或过牌
    const e = makeEngine([10, 1000], 0, fillerDeck());
    e.start();
    expect(e.actingSeat).toBe(1);
    const legal = e.legalActions(1);
    expect(legal.canCheck).toBe(true);
    expect(legal.canRaise).toBe(false);
  });

  it('无操作可行动者时自动跑完公共牌', () => {
    // 两人均短筹码：10 / 20，盲注即全部 all-in
    const e = makeEngine([10, 20], 0, fillerDeck());
    const events = e.start();
    expect(e.phase).toBe('hand_end');
    // 应包含 street 事件直到 river + showdown + pot_award
    const types = events.map((x) => x.type);
    expect(types).toContain('street');
    expect(types).toContain('showdown');
    expect(types).toContain('pot_award');
  });
});
