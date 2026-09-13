import type {
  CardStr,
  GameEvent,
  GamePhase,
  GameState,
  LegalActions,
  PotAward,
  ShowdownEntry,
} from '@th/shared';
import { Deck } from './deck.js';
import { blindSeats, nextSeat } from './positions.js';
import { buildPots, splitPot } from './sidePots.js';
import { evaluate7, pickWinners, type EvaluatedHand } from './evaluator.js';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** 引擎产出的事件（seq 由 Room 统一编号） */
export type EngineEvent = DistributiveOmit<GameEvent, 'seq'>;

export interface EngineSeatInput {
  seatIndex: number;
  playerId: string;
  nickname: string;
  stack: number;
  connected: boolean;
}

export interface EngineConfig {
  smallBlind: number;
  bigBlind: number;
  handNumber: number;
}

interface HandPlayer {
  seatIndex: number;
  playerId: string;
  nickname: string;
  connected: boolean;
  stack: number;
  /** 当前这一街的注 */
  bet: number;
  /** 整手牌累计投入 */
  committed: number;
  hole: CardStr[];
  folded: boolean;
  allIn: boolean;
  acted: boolean;
  lastAction: string | null;
}

const STREET_FLOW: Record<string, 'flop' | 'turn' | 'river' | 'showdown'> = {
  preflop: 'flop',
  flop: 'turn',
  turn: 'river',
  river: 'showdown',
};

/**
 * 一手牌的完整状态机。每个实例只负责一手牌：
 * 盲注 → 发底牌 → 四条街下注 → 摊牌/收池 → 分池。
 * 纯逻辑、无 IO，可注入固定牌堆做确定性测试。
 */
export class HandEngine {
  readonly config: EngineConfig;
  readonly dealerSeat: number;
  private players: HandPlayer[];
  private deck: Deck;
  private board: CardStr[] = [];
  phase: GamePhase = 'idle';
  private currentBet = 0;
  /** 上一次完整加注的增量（决定最小加注尺度） */
  private lastRaiseSize: number;
  actingSeat: number | null = null;
  private showdownResults: ShowdownEntry[] | null = null;
  private awardsResult: PotAward[] | null = null;
  private handEnded = false;
  /** 结算阶段玩家主动亮出的底牌："seatIndex:cardIndex" */
  private revealedHoles = new Set<string>();

  constructor(seats: EngineSeatInput[], dealerSeat: number, config: EngineConfig, deck?: Deck) {
    if (seats.length < 2) throw new Error('至少需要 2 名玩家');
    this.players = seats.map((s) => ({
      ...s,
      bet: 0,
      committed: 0,
      hole: [],
      folded: false,
      allIn: false,
      acted: false,
      lastAction: null,
    }));
    this.dealerSeat = dealerSeat;
    this.config = config;
    this.lastRaiseSize = config.bigBlind;
    this.deck = deck ?? new Deck();
  }

  // ---------- 基础查询 ----------

  get seatIndexes(): number[] {
    return this.players.map((p) => p.seatIndex);
  }

  private player(seat: number): HandPlayer {
    const p = this.players.find((x) => x.seatIndex === seat);
    if (!p) throw new Error(`座位 ${seat} 不在本手牌中`);
    return p;
  }

  getHoleCards(seat: number): CardStr[] {
    return [...this.player(seat).hole];
  }

  /**
   * 结算阶段：切换亮出/盖上自己的一张底牌（亮出时所有人可见）。
   * 仅在摊牌/手牌结束后允许；返回切换后的状态（true = 亮出）。
   */
  toggleHole(seat: number, cardIndex: number): boolean {
    if (this.phase !== 'showdown' && this.phase !== 'hand_end') {
      throw new Error('手牌结束后才能亮牌');
    }
    const p = this.player(seat);
    if (cardIndex < 0 || cardIndex >= p.hole.length) throw new Error('无效的底牌');
    const key = `${seat}:${cardIndex}`;
    if (this.revealedHoles.has(key)) {
      this.revealedHoles.delete(key);
      return false;
    }
    this.revealedHoles.add(key);
    return true;
  }

  potTotal(): number {
    // committed 在下注时已累计（含当前街注额），无需再加 bet
    return this.players.reduce((s, p) => s + p.committed, 0);
  }

  get isHandEnded(): boolean {
    return this.handEnded;
  }

  /** 手牌结束后的最终筹码（座位 -> stack） */
  finalStacks(): Map<number, number> {
    return new Map(this.players.map((p) => [p.seatIndex, p.stack]));
  }

  // ---------- 手牌流程 ----------

  /** 开始一手牌：下盲注、发底牌、进入翻前。返回有序事件。 */
  start(): EngineEvent[] {
    const events: EngineEvent[] = [];
    this.phase = 'preflop';
    events.push({ type: 'hand_start', handNumber: this.config.handNumber, dealerSeat: this.dealerSeat });

    const blinds = blindSeats(this.seatIndexes, this.dealerSeat);
    this.postBlind(this.player(blinds.smallBlind), this.config.smallBlind, 'sb', events);
    this.postBlind(this.player(blinds.bigBlind), this.config.bigBlind, 'bb', events);
    this.currentBet = this.config.bigBlind;
    this.lastRaiseSize = this.config.bigBlind;

    // 发底牌：从小盲位置开始，每人一张轮两圈
    const order: number[] = [];
    let s = blinds.smallBlind;
    for (let i = 0; i < this.players.length; i++) {
      order.push(s);
      s = nextSeat(this.seatIndexes, s);
    }
    for (let round = 0; round < 2; round++) {
      for (const seat of order) this.player(seat).hole.push(this.deck.draw());
    }
    events.push({ type: 'deal_hole', seatIndexes: order });

    this.actingSeat = this.nextActionableFrom(blinds.firstToActPreflop);
    if (this.actingSeat === null) {
      // 极端情况：所有人盲注即 all-in，直接跑完公共牌
      events.push(...this.runoutAndShowdown());
    }
    return events;
  }

  private postBlind(p: HandPlayer, amount: number, blind: 'sb' | 'bb', events: EngineEvent[]): void {
    const actual = Math.min(amount, p.stack);
    p.stack -= actual;
    p.bet += actual;
    p.committed += actual;
    if (p.stack === 0) p.allIn = true;
    p.lastAction = blind === 'sb' ? `小盲 ${actual}` : `大盲 ${actual}`;
    events.push({ type: 'post_blind', seatIndex: p.seatIndex, amount: actual, blind });
  }

  /** 从 from 开始顺时针找第一个可行动（未弃牌、未 all-in）的玩家；含 from。 */
  private nextActionableFrom(from: number): number | null {
    let s = from;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.player(s);
      if (!p.folded && !p.allIn) return s;
      s = nextSeat(this.seatIndexes, s);
    }
    return null;
  }

  // ---------- 合法动作 ----------

  legalActions(seat: number, turnDeadline = 0): LegalActions {
    const p = this.player(seat);
    const toCall = Math.min(this.currentBet - p.bet, p.stack);
    const canCheck = toCall === 0;
    // 加注条件：跟注后仍有剩余筹码；本街尚未行动过（或行动后被完整加注重开）；
    // 且存在仍可行动的对手（对手全 all-in 时不允许再加注）。
    const hasActionableOpponent = this.players.some((q) => q !== p && !q.folded && !q.allIn);
    const canRaise = p.stack > toCall && !p.acted && hasActionableOpponent;
    const maxRaiseTo = p.bet + p.stack;
    const fullMinRaiseTo = this.currentBet + this.lastRaiseSize;
    // 筹码不足最小加注时仍允许全下（不构成完整加注，不重开行动轮）
    const minRaiseTo = Math.min(fullMinRaiseTo, maxRaiseTo);
    return {
      canFold: true,
      canCheck,
      callAmount: canCheck ? 0 : toCall,
      canRaise,
      minRaiseTo,
      maxRaiseTo,
      pot: this.potTotal(),
      turnDeadline,
    };
  }

  // ---------- 玩家行动 ----------

  act(
    seat: number,
    action: 'fold' | 'check' | 'call' | 'raise',
    amount?: number,
  ): EngineEvent[] {
    if (this.handEnded) throw new Error('手牌已结束');
    if (this.actingSeat !== seat) throw new Error('还没轮到你行动');
    const p = this.player(seat);
    if (p.folded || p.allIn) throw new Error('你无法行动');

    const legal = this.legalActions(seat);
    const events: EngineEvent[] = [];

    switch (action) {
      case 'fold': {
        p.folded = true;
        p.acted = true;
        p.lastAction = '弃牌';
        events.push(this.actionEvent(p, 'fold', 0));
        break;
      }
      case 'check': {
        if (!legal.canCheck) throw new Error('现在不能过牌');
        p.acted = true;
        p.lastAction = '过牌';
        events.push(this.actionEvent(p, 'check', 0));
        break;
      }
      case 'call': {
        if (legal.canCheck) throw new Error('无需跟注，可以过牌');
        const chips = legal.callAmount;
        this.applyChips(p, chips);
        p.acted = true;
        p.lastAction = p.allIn ? `全下 ${p.bet}` : `跟注 ${p.bet}`;
        events.push(this.actionEvent(p, p.allIn ? 'allin' : 'call', chips));
        break;
      }
      case 'raise': {
        if (!legal.canRaise) throw new Error('筹码不足以加注');
        const target = amount;
        if (target === undefined || !Number.isInteger(target)) throw new Error('缺少加注金额');
        if (target > legal.maxRaiseTo) throw new Error('超出你的全部筹码');
        const isAllIn = target === legal.maxRaiseTo;
        if (target < legal.minRaiseTo && !isAllIn) {
          throw new Error(`最小加注到 ${legal.minRaiseTo}`);
        }
        if (target <= this.currentBet) throw new Error('加注必须大于当前注额');

        const increment = target - this.currentBet;
        const isFullRaise = increment >= this.lastRaiseSize;
        const chips = target - p.bet;
        this.applyChips(p, chips);
        p.acted = true;
        p.lastAction = p.allIn ? `全下 ${p.bet}` : `加注到 ${p.bet}`;

        this.currentBet = target;
        if (isFullRaise) {
          this.lastRaiseSize = increment;
          // 完整加注：重开行动轮，其他未弃牌未 all-in 的玩家需重新行动
          for (const q of this.players) {
            if (q !== p && !q.folded && !q.allIn) q.acted = false;
          }
        }
        events.push(this.actionEvent(p, p.allIn ? 'allin' : 'raise', chips));
        break;
      }
    }

    events.push(...this.advance());
    return events;
  }

  private applyChips(p: HandPlayer, chips: number): void {
    p.stack -= chips;
    p.bet += chips;
    p.committed += chips;
    if (p.stack === 0) p.allIn = true;
  }

  private actionEvent(p: HandPlayer, action: 'fold' | 'check' | 'call' | 'raise' | 'allin', amount: number): EngineEvent {
    return {
      type: 'player_action',
      seatIndex: p.seatIndex,
      action,
      amount,
      betTotal: p.bet,
      stackAfter: p.stack,
      potTotal: this.potTotal(),
    };
  }

  // ---------- 轮次推进 ----------

  private streetComplete(): boolean {
    return this.players.every((p) => p.folded || p.allIn || (p.acted && p.bet === this.currentBet));
  }

  private activePlayers(): HandPlayer[] {
    return this.players.filter((p) => !p.folded);
  }

  private advance(): EngineEvent[] {
    const events: EngineEvent[] = [];
    const active = this.activePlayers();

    // 只剩一人未弃牌：直接收池，不露牌
    if (active.length === 1) {
      events.push(...this.awardUncontested(active[0]));
      return events;
    }

    if (!this.streetComplete()) {
      // 轮到下一位可行动玩家
      this.actingSeat = this.nextActionableFrom(nextSeat(this.seatIndexes, this.actingSeat!));
      if (this.actingSeat === null) {
        // 其余人全部 all-in：直接跑完剩余公共牌
        events.push(...this.runoutAndShowdown());
      }
      return events;
    }

    // 本街结束
    events.push(...this.closeStreet());
    return events;
  }

  private countActionable(): number {
    return this.players.filter((p) => !p.folded && !p.allIn).length;
  }

  /** 收拢本街注额，进入下一条街；若无人可再行动则连续发牌到摊牌。 */
  private closeStreet(): EngineEvent[] {
    const events: EngineEvent[] = [];
    for (const p of this.players) {
      p.bet = 0;
      p.acted = false;
      p.lastAction = null; // 上一街的动作标识随街道推进清空（翻牌/转牌/河牌后不再显示）
    }
    this.currentBet = 0;
    this.lastRaiseSize = this.config.bigBlind;

    const next = STREET_FLOW[this.phase];
    if (!next || next === 'showdown') {
      events.push(...this.doShowdown());
      return events;
    }

    this.phase = next;
    const count = next === 'flop' ? 3 : 1;
    for (let i = 0; i < count; i++) this.board.push(this.deck.draw());
    events.push({ type: 'street', street: next, cards: this.board.slice(-count), board: [...this.board] });

    // 翻后第一个可行动者：dealer 顺时针下一家起。
    // 可行动者 ≤1（其余全 all-in）时不再有下注轮，连续发完剩余街。
    const blinds = blindSeats(this.seatIndexes, this.dealerSeat);
    this.actingSeat = this.nextActionableFrom(blinds.firstToActPostflop);
    if (this.actingSeat === null || this.countActionable() <= 1) {
      this.actingSeat = null;
      events.push(...this.closeStreet());
    }
    return events;
  }

  /** 剩余公共牌自动发完并摊牌（所有人 all-in 的情形） */
  private runoutAndShowdown(): EngineEvent[] {
    const events: EngineEvent[] = [];
    while (this.board.length < 5) {
      const nextPhase = STREET_FLOW[this.phase];
      if (!nextPhase || nextPhase === 'showdown') break;
      this.phase = nextPhase;
      const count = nextPhase === 'flop' ? 3 : 1;
      for (let i = 0; i < count; i++) this.board.push(this.deck.draw());
      events.push({ type: 'street', street: nextPhase, cards: this.board.slice(-count), board: [...this.board] });
    }
    events.push(...this.doShowdown());
    return events;
  }

  // ---------- 摊牌与分池 ----------

  private doShowdown(): EngineEvent[] {
    const events: EngineEvent[] = [];
    this.phase = 'showdown';
    this.actingSeat = null;

    const active = this.activePlayers();
    const evaluated = new Map<number, EvaluatedHand>();
    this.showdownResults = [];
    for (const p of active) {
      const ev = evaluate7([...p.hole, ...this.board]);
      evaluated.set(p.seatIndex, ev);
      this.showdownResults.push({ seatIndex: p.seatIndex, cards: [...p.hole], handName: ev.handName });
    }
    events.push({ type: 'showdown', results: this.showdownResults });

    // 边池分层，逐层比牌分配
    const pots = buildPots(
      this.players.map((p) => ({ seatIndex: p.seatIndex, amount: p.committed, folded: p.folded, allIn: p.allIn })),
    );
    const awardMap = new Map<number, { amount: number; handName: string | null }>();
    for (const pot of pots) {
      const eligible = new Map<number, EvaluatedHand>();
      for (const seat of pot.eligibleSeats) {
        const ev = evaluated.get(seat);
        if (ev) eligible.set(seat, ev);
      }
      if (eligible.size === 0) continue;
      const winners = pickWinners(eligible);
      const shares = splitPot(pot.amount, winners, this.dealerSeat);
      for (const [seat, chips] of shares) {
        const cur = awardMap.get(seat) ?? { amount: 0, handName: evaluated.get(seat)?.handName ?? null };
        cur.amount += chips;
        awardMap.set(seat, cur);
      }
    }

    this.awardsResult = [...awardMap.entries()]
      .map(([seatIndex, a]) => ({ seatIndex, amount: a.amount, handName: a.handName }))
      .filter((a) => a.amount > 0);
    for (const a of this.awardsResult) this.player(a.seatIndex).stack += a.amount;

    events.push({ type: 'pot_award', awards: this.awardsResult });
    events.push(...this.finishHand());
    return events;
  }

  /** 其他玩家全部弃牌，直接收池（不露牌、不评估牌型：未摊牌即保密信息） */
  private awardUncontested(winner: HandPlayer): EngineEvent[] {
    this.phase = 'hand_end';
    this.actingSeat = null;
    const total = this.potTotal();
    winner.stack += total;
    this.awardsResult = [{ seatIndex: winner.seatIndex, amount: total, handName: null }];
    return [
      { type: 'pot_award', awards: this.awardsResult },
      ...this.finishHand(),
    ];
  }

  private finishHand(): EngineEvent[] {
    this.phase = 'hand_end';
    this.actingSeat = null;
    this.handEnded = true;
    return [{ type: 'hand_end', handNumber: this.config.handNumber }];
  }

  // ---------- 状态导出 ----------

  /** 生成公开游戏状态（座位部分由 Room 通过 toSeatStates 组装） */
  toPublicState(): GameState {
    const pots = buildPots(
      this.players.map((p) => ({ seatIndex: p.seatIndex, amount: p.committed, folded: p.folded, allIn: p.allIn })),
    );
    return {
      phase: this.phase,
      handNumber: this.config.handNumber,
      dealerSeat: this.dealerSeat,
      smallBlind: this.config.smallBlind,
      bigBlind: this.config.bigBlind,
      board: [...this.board],
      pots: pots.map((p) => ({ amount: p.amount, eligibleSeats: p.eligibleSeats })),
      potTotal: this.potTotal(),
      currentBet: this.currentBet,
      minRaiseTo: this.currentBet + this.lastRaiseSize,
      actingSeat: this.actingSeat,
      turnDeadline: null, // 由 Room 填
      dealerDraw: null, // 由 Room 填（抽牌阶段）
      showdown: this.showdownResults,
      awards: this.awardsResult,
      revealedHoles: [...this.revealedHoles].map((k) => {
        const [seatIndex, cardIndex] = k.split(':').map(Number);
        return { seatIndex, cardIndex };
      }),
    };
  }

  /** 座位状态（脱敏由 Room/toSeatStates 完成） */
  toSeatStates(forPlayerId: string | null) {
    const revealedSeats = new Set((this.showdownResults ?? []).map((r) => r.seatIndex));
    const showdownPhase = this.phase === 'showdown' || this.phase === 'hand_end';
    return this.players.map((p) => {
      // 本人始终可见；摊牌者亮出全部；其余逐张保密，除非本人在结算阶段主动亮出
      const publicAll = showdownPhase && revealedSeats.has(p.seatIndex);
      const holeCards =
        p.hole.length === 0
          ? null
          : p.hole.map((c, i) =>
              p.playerId === forPlayerId || publicAll || this.revealedHoles.has(`${p.seatIndex}:${i}`) ? c : null,
            );
      return {
        seatIndex: p.seatIndex,
        playerId: p.playerId,
        nickname: p.nickname,
        connected: p.connected,
        stack: p.stack,
        bet: p.bet,
        committed: p.committed,
        holeCards,
        hasFolded: p.folded,
        isAllIn: p.allIn,
        hasActed: p.acted,
        isDealer: p.seatIndex === this.dealerSeat,
        lastAction: p.lastAction,
      };
    });
  }
}
