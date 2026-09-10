import { describe, it, expect } from 'vitest';
import { HandEngine, type EngineEvent } from '../src/engine/HandEngine.js';
import { Deck } from '../src/engine/deck.js';
import { evaluate7 } from '../src/engine/evaluator.js';

const SB = 10;
const BB = 20;

function makeEngine(stacks: number[], dealerSeat: number, deckCards: string[]) {
  const seats = stacks.map((stack, i) => ({
    seatIndex: i,
    playerId: `p${i}`,
    nickname: `玩家${i}`,
    stack,
    connected: true,
  }));
  return new HandEngine(seats, dealerSeat, { smallBlind: SB, bigBlind: BB, handNumber: 1 }, new Deck(deckCards));
}

function types(events: EngineEvent[]): string[] {
  return events.map((e) => e.type);
}

describe('整手牌流程', () => {
  it('heads-up checkdown：同花胜一对，摊牌分池正确', () => {
    // 发牌顺序 heads-up dealer=0：[s0,s1] 轮两圈，之后 flop3 turn1 river1
    const deck = [
      'As', '2c', 'Ks', '2d', // 底牌：s0=As Ks，s1=2c 2d
      'Qs', 'Js', '5s', // flop
      '3h', // turn
      '7d', // river
    ];
    const e = makeEngine([1000, 1000], 0, deck);
    e.start();

    e.act(0, 'call'); // SB(dealer) 跟注
    e.act(1, 'check'); // BB option 过牌 → flop
    expect(e.phase).toBe('flop');
    expect(e.actingSeat).toBe(1); // 翻后 BB 先行

    e.act(1, 'check');
    e.act(0, 'check'); // turn
    e.act(1, 'check');
    e.act(0, 'check'); // river
    const events = e.act(1, 'check');
    e.act(0, 'check');

    expect(e.phase).toBe('hand_end');
    const state = e.toPublicState();
    expect(state.board).toEqual(['Qs', 'Js', '5s', '3h', '7d']);
    expect(state.showdown).toHaveLength(2);
    const s0 = state.showdown!.find((r) => r.seatIndex === 0)!;
    expect(s0.handName).toBe('同花');
    expect(state.awards).toEqual([{ seatIndex: 0, amount: 40, handName: '同花' }]);
    expect(e.finalStacks().get(0)).toBe(1020);
    expect(e.finalStacks().get(1)).toBe(980);
  });

  it('平分池：两人同为 Broadway 顺子', () => {
    const deck = [
      'Ah', 'Ad', 'Kh', 'Kd', // s0=Ah Kh，s1=Ad Kd
      'Qs', 'Jc', 'Td', // flop
      '3h', // turn
      '3c', // river
    ];
    const e = makeEngine([1000, 1000], 0, deck);
    e.start();
    e.act(0, 'call');
    e.act(1, 'check');
    e.act(1, 'check');
    e.act(0, 'check');
    e.act(1, 'check');
    e.act(0, 'check');
    e.act(1, 'check');
    e.act(0, 'check');

    const state = e.toPublicState();
    expect(state.phase).toBe('hand_end');
    expect(state.awards).toHaveLength(2);
    expect(state.awards!.every((a) => a.amount === 20)).toBe(true);
    expect(e.finalStacks().get(0)).toBe(1000);
    expect(e.finalStacks().get(1)).toBe(1000);
  });

  it('三人 all-in：主池/边池分别按资格分配', () => {
    // 发牌顺序 dealer=0：[SB=1, BB=2, UTG=0] 轮两圈
    const deck = [
      'Ks', 'Qs', 'As', // 第一张：s1 Ks, s2 Qs, s0 As
      'Kh', 'Qh', 'Ah', // 第二张：s1 Kh, s2 Qh, s0 Ah
      '2d', '7c', '8d', // flop
      'Jh', // turn
      '3c', // river
    ];
    const e = makeEngine([100, 200, 300], 0, deck);
    e.start();

    e.act(0, 'raise', 100); // UTG 全下
    e.act(1, 'call'); // SB 跟 100（剩 100）
    e.act(2, 'call'); // BB 跟 100（剩 200）
    expect(e.phase).toBe('flop');

    const runoutEvents = [
      ...e.act(1, 'raise', 100), // SB 全下 100
      ...e.act(2, 'call'), // BB 跟 100（剩 100）
    ];
    // 此后只剩 seat2 可行动但无对手 → 自动发完 turn/river 并摊牌
    expect(e.phase).toBe('hand_end');
    const t = types(runoutEvents);
    expect(t.filter((x) => x === 'street')).toHaveLength(2); // turn + river
    expect(t).toContain('showdown');

    const state = e.toPublicState();
    // 主池 300（0/1/2 均有资格），边池 200（仅 1/2）
    expect(state.pots).toEqual([
      { amount: 300, eligibleSeats: [0, 1, 2] },
      { amount: 200, eligibleSeats: [1, 2] },
    ]);
    // 主池：seat0 一对A 胜；边池：seat1 一对K 胜 seat2 一对Q
    const awardOf = (seat: number) => state.awards!.find((a) => a.seatIndex === seat)?.amount ?? 0;
    expect(awardOf(0)).toBe(300);
    expect(awardOf(1)).toBe(200);
    expect(awardOf(2)).toBe(0);
    expect(e.finalStacks().get(0)).toBe(300);
    expect(e.finalStacks().get(1)).toBe(200);
    expect(e.finalStacks().get(2)).toBe(100);
  });

  it('所有人弃牌：直接收池，不摊牌不露牌', () => {
    const deck = ['As', '2c', 'Ks', '2d', 'Qs', 'Js', '5s', '3h', '7d'];
    const e = makeEngine([1000, 1000], 0, deck);
    e.start();
    e.act(0, 'raise', 100);
    const events = e.act(1, 'fold');

    expect(e.phase).toBe('hand_end');
    const t = types(events);
    expect(t).toContain('pot_award');
    expect(t).not.toContain('showdown');
    const state = e.toPublicState();
    expect(state.showdown).toBeNull();
    expect(state.awards).toEqual([{ seatIndex: 0, amount: 120, handName: null }]);
    expect(e.finalStacks().get(0)).toBe(1020);
    // 弃牌者底牌不公开（座位状态中为 null 占位）
    const seatStates = e.toSeatStates(null);
    expect(seatStates.find((s) => s.seatIndex === 1)!.holeCards).toEqual([null, null]);
    // 但本人重连时仍可见自己的牌（用于恢复界面）
    const ownStates = e.toSeatStates('p1');
    expect(ownStates.find((s) => s.seatIndex === 1)!.holeCards).toEqual(['2c', '2d']);
  });

  it('未摊牌收池不标注牌型；结算阶段可逐张亮牌，亮出后全员可见', () => {
    const deck = ['As', '2c', 'Ks', '2d', 'Qs', 'Js', '5s', '3h', '7d'];
    const e = makeEngine([1000, 1000], 0, deck);
    e.start();
    e.act(0, 'call');
    e.act(1, 'check'); // 进入翻牌圈：Qs Js 5s
    expect(e.phase).toBe('flop');
    // 手牌进行中不允许亮牌
    expect(() => e.toggleHole(1, 0)).toThrow('手牌结束后才能亮牌');
    e.act(1, 'raise', 100);
    e.act(0, 'fold');

    expect(e.phase).toBe('hand_end');
    const state = e.toPublicState();
    expect(state.showdown).toBeNull();
    // 未摊牌：赢家牌型保密（seat1 虽有一对 2，但不标注）
    expect(state.awards).toEqual([{ seatIndex: 1, amount: 140, handName: null }]);
    expect(e.finalStacks().get(1)).toBe(1020);
    // 未亮牌前其他人看不到赢家底牌
    expect(e.toSeatStates(null).find((s) => s.seatIndex === 1)!.holeCards).toEqual([null, null]);

    // 逐张亮牌：一次只亮一张，亮出后所有人可见
    expect(e.toggleHole(1, 0)).toBe(true);
    expect(e.toSeatStates(null).find((s) => s.seatIndex === 1)!.holeCards).toEqual(['2c', null]);
    expect(e.toPublicState().revealedHoles).toEqual([{ seatIndex: 1, cardIndex: 0 }]);
    // 再次点击盖上：他人重新看不到
    expect(e.toggleHole(1, 0)).toBe(false);
    expect(e.toSeatStates(null).find((s) => s.seatIndex === 1)!.holeCards).toEqual([null, null]);
    expect(e.toPublicState().revealedHoles).toEqual([]);
    // 可以再亮另一张
    expect(e.toggleHole(1, 1)).toBe(true);
    expect(e.toSeatStates(null).find((s) => s.seatIndex === 1)!.holeCards).toEqual([null, '2d']);
    // 本人始终可见自己的牌
    expect(e.toSeatStates('p1').find((s) => s.seatIndex === 1)!.holeCards).toEqual(['2c', '2d']);
  });
});

describe('比牌器', () => {
  it('A-5 轮子顺子', () => {
    const ev = evaluate7(['As', '2d', '3h', '4c', '5s', '9d', 'Tc']);
    expect(ev.handName).toBe('顺子');
  });

  it('葫芦', () => {
    const ev = evaluate7(['As', 'Ad', 'Kh', 'Kc', 'Ks', '9d', '2c']);
    expect(ev.handName).toBe('葫芦');
  });

  it('高牌', () => {
    const ev = evaluate7(['As', 'Kd', '9h', '7c', '5s', '3d', '2c']);
    expect(ev.handName).toBe('高牌');
  });
});
