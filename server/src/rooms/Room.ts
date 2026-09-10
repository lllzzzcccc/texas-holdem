import { randomInt, randomUUID } from 'node:crypto';
import type {
  CardStr,
  CreateRoomOptions,
  GameEvent,
  GameState,
  LegalActions,
  RoomState,
  SeatState,
} from '@th/shared';
import { Deck, compareHighCard } from '../engine/deck.js';
import { HandEngine, type EngineEvent } from '../engine/HandEngine.js';
import { nextSeat } from '../engine/positions.js';
import { config } from '../config.js';

export interface Player {
  id: string;
  nickname: string;
  socketId: string | null;
  connected: boolean;
  joinedAt: number;
}

interface Seat {
  seatIndex: number;
  playerId: string;
  /** 手牌间的持久筹码（手牌进行中以引擎为准） */
  stack: number;
}

/** Room 对外输出（由 gateway 实现，桥接 socket.io） */
export interface RoomHooks {
  /** 广播带 seq 的游戏事件 */
  emitEvent(ev: GameEvent): void;
  /** 向每个在线玩家广播其个性化房间状态 */
  emitState(): void;
  /** 私信某玩家：底牌 / 轮到其行动 */
  emitToPlayer(playerId: string, payload: { holeCards?: CardStr[]; yourTurn?: LegalActions }): void;
  /** 房间无人可担任房主时调用：立即从大厅销毁本房间 */
  destroyRoom(): void;
}

export class Room {
  readonly code: string;
  hostId: string;
  status: 'lobby' | 'playing' = 'lobby';
  players = new Map<string, Player>();
  seats: (Seat | null)[];

  maxSeats: number;
  minBuyIn: number;
  maxBuyIn: number;
  smallBlind: number;
  bigBlind: number;
  /** 回合行动最长时间（ms） */
  turnTimeoutMs: number;
  /** 回合数上限（0 = 不限） */
  maxHands: number;

  emptySince: number | null = null;

  private hooks: RoomHooks;
  private seq = 0;
  private handNumber = 0;
  private dealerSeat = -1;
  private engine: HandEngine | null = null;
  /** 开局抽牌定庄：52 张盖牌摊在桌面，玩家各自抽一张，全部抽完统一揭晓 */
  private dealerDraw: {
    /** 牌堆（保密，索引即桌面位置） */
    pool: CardStr[];
    /** 已被抽走的牌：牌堆索引 → 抽牌者 */
    taken: Map<number, { seatIndex: number; card: CardStr }>;
    /** 是否已揭晓比大小 */
    revealed: boolean;
    dealerSeat: number | null;
  } | null = null;
  private drawTimer: NodeJS.Timeout | null = null;
  private drawDeadline: number | null = null;

  private turnTimer: NodeJS.Timeout | null = null;
  private turnDeadline: number | null = null;
  private nextHandTimer: NodeJS.Timeout | null = null;
  private handFinalized = false;
  private disconnectTimers = new Map<string, NodeJS.Timeout>();
  private forfeited = new Set<string>();

  constructor(code: string, hostId: string, hooks: RoomHooks, options: CreateRoomOptions = {}) {
    this.code = code;
    this.hostId = hostId;
    this.hooks = hooks;

    // 房间设置（带校验与默认值）
    const sb = Math.floor(options.smallBlind ?? 10);
    const bb = Math.floor(options.bigBlind ?? 20);
    this.smallBlind = Number.isFinite(sb) && sb >= 1 ? sb : 10;
    this.bigBlind = Number.isFinite(bb) && bb > this.smallBlind ? bb : this.smallBlind * 2;
    const seats = Math.floor(options.maxSeats ?? 9);
    this.maxSeats = Math.min(9, Math.max(2, Number.isFinite(seats) ? seats : 9));
    const turnSec = Math.floor(options.turnTimeoutSec ?? 30);
    this.turnTimeoutMs = Math.min(120, Math.max(10, Number.isFinite(turnSec) ? turnSec : 30)) * 1000;
    const hands = Math.floor(options.maxHands ?? 0);
    this.maxHands = Math.min(200, Math.max(0, Number.isFinite(hands) ? hands : 0));
    // 买入范围跟随盲注：20BB ~ 200BB
    this.minBuyIn = this.bigBlind * 20;
    this.maxBuyIn = this.bigBlind * 200;

    this.seats = Array.from({ length: this.maxSeats }, () => null);
  }

  destroy(): void {
    this.clearTurnTimer();
    this.clearDrawTimer();
    if (this.nextHandTimer) clearTimeout(this.nextHandTimer);
    for (const t of this.disconnectTimers.values()) clearTimeout(t);
  }

  /** 主动广播一次状态（如玩家创建房间后） */
  notifyState(): void {
    this.hooks.emitState();
  }

  /** 大厅牌桌摘要 */
  summary(): import('@th/shared').RoomSummary {
    const seated = this.seats.filter(Boolean).length;
    return {
      code: this.code,
      status: this.status,
      seated,
      maxSeats: this.maxSeats,
      spectators: Math.max(0, this.players.size - seated),
      handNumber: this.handNumber,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      hostNickname: this.players.get(this.hostId)?.nickname ?? '',
    };
  }

  // ---------- 玩家进出 ----------

  /** 加入房间（或凭 playerId 重连）。返回玩家与是否为新玩家。 */
  addPlayer(nickname: string, socketId: string, playerId?: string): { player: Player; isNew: boolean } {
    if (playerId) {
      const existing = this.players.get(playerId);
      if (existing) {
        existing.socketId = socketId;
        existing.connected = true;
        existing.nickname = nickname || existing.nickname;
        this.clearDisconnectTimer(playerId);
        this.forfeited.delete(playerId);
        this.emptySince = null;
        this.hooks.emitState();
        // 重连：补发底牌与（若轮到他）行动面板
        if (this.engine && !this.engine.isHandEnded) {
          const seat = this.seatOfPlayer(playerId);
          if (seat !== null) {
            try {
              const hole = this.engine.getHoleCards(seat);
              if (hole.length > 0) this.hooks.emitToPlayer(playerId, { holeCards: hole });
              if (this.engine.actingSeat === seat) this.sendYourTurn();
            } catch {
              /* 不在本手牌中 */
            }
          }
        }
        return { player: existing, isNew: false };
      }
    }
    if (!playerId) {
      // 兜底：同一 socket 重复加入（如建房后未带令牌进房）→ 复用已有玩家，避免幽灵身份
      const bySocket = [...this.players.values()].find((p) => p.socketId === socketId);
      if (bySocket) {
        bySocket.nickname = nickname || bySocket.nickname;
        return { player: bySocket, isNew: false };
      }
    }
    const player: Player = {
      id: playerId && !this.players.has(playerId) ? playerId : randomUUID(),
      nickname,
      socketId,
      connected: true,
      joinedAt: Date.now(),
    };
    this.players.set(player.id, player);
    this.emptySince = null;
    return { player, isNew: true };
  }

  markDisconnected(playerId: string, socketId: string): void {
    const p = this.players.get(playerId);
    if (!p || p.socketId !== socketId) return; // 已用新连接重连
    p.connected = false;
    p.socketId = null;

    if (this.players.size > 0 && ![...this.players.values()].some((x) => x.connected)) {
      this.emptySince = Date.now();
    }
    // 房主掉线不立即易主：保留 60s 重连宽限，宽限到期未归（removePlayer）时再按加入顺序转移

    // 手牌进行中：座位保留（回合计时器会自动 check/fold）；
    // 宽限期到后标记逐出，手牌结束时移除。
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(playerId);
      this.forfeited.add(playerId);
      const handRunning = this.engine !== null && !this.engine.isHandEnded;
      if (!handRunning) this.removePlayer(playerId);
      this.hooks.emitState();
    }, config.disconnectGraceMs);
    this.disconnectTimers.set(playerId, timer);
    this.hooks.emitState();
  }

  leaveRoom(playerId: string): void {
    const seat = this.seatOfPlayer(playerId);
    const handRunning = this.engine !== null && !this.engine.isHandEnded;
    const inHand = handRunning && seat !== null && this.isParticipant(seat);
    if (inHand) {
      // 手牌中离开 = 立即弃牌（若轮到他）并标记逐出，手牌结束移除
      this.forfeited.add(playerId);
      if (this.engine!.actingSeat === seat) {
        try {
          this.processEvents(this.engine!.act(seat, 'fold'));
        } catch {
          /* 已被自动行动 */
        }
      }
    } else {
      this.removePlayer(playerId);
    }
    if (playerId === this.hostId) this.transferHost();
    this.hooks.emitState();
  }

  private removePlayer(playerId: string): void {
    const seat = this.seatOfPlayer(playerId);
    if (seat !== null) this.seats[seat] = null;
    this.players.delete(playerId);
    this.clearDisconnectTimer(playerId);
    this.forfeited.delete(playerId);
    if (playerId === this.hostId) this.transferHost();
    // 抽牌阶段有人离开：剩余玩家若都已抽完则直接揭晓
    if (this.dealerDraw && !this.dealerDraw.revealed) this.maybeFinishDraw();
    // 没有任何玩家 = 没有房主，立即销毁，不等空房倒计时
    if (this.players.size === 0) {
      this.hooks.destroyRoom();
      return;
    }
    if (![...this.players.values()].some((x) => x.connected)) this.emptySince = Date.now();
  }

  /** 房主离开/被移除时：按加入顺序转移给下一位在线玩家 */
  private transferHost(): void {
    const next = [...this.players.values()]
      .filter((p) => p.connected && p.id !== this.hostId)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (next) this.hostId = next.id;
  }

  // ---------- 房间设置 ----------

  /** 房主在大厅阶段修改房间参数 */
  configure(playerId: string, options: CreateRoomOptions): void {
    if (playerId !== this.hostId) throw new Error('只有房主可以修改房间设置');
    if (this.status !== 'lobby') throw new Error('游戏进行中不能修改房间设置');

    const sb = Math.floor(options.smallBlind ?? this.smallBlind);
    const bb = Math.floor(options.bigBlind ?? this.bigBlind);
    if (!Number.isFinite(sb) || sb < 1) throw new Error('小盲至少为 1');
    if (!Number.isFinite(bb) || bb <= sb) throw new Error('大盲必须大于小盲');

    const seats = Math.floor(options.maxSeats ?? this.maxSeats);
    if (!Number.isFinite(seats) || seats < 2 || seats > 9) throw new Error('座位数需在 2~9 之间');
    const maxOccupied = this.seats.reduce((m, s, i) => (s ? i + 1 : m), 0);
    if (seats < maxOccupied) throw new Error(`已有玩家坐在 ${maxOccupied} 号位，座位数不能小于它`);

    const turnSec = Math.floor(options.turnTimeoutSec ?? this.turnTimeoutMs / 1000);
    if (!Number.isFinite(turnSec) || turnSec < 10 || turnSec > 120) throw new Error('思考时间需在 10~120 秒之间');

    const hands = Math.floor(options.maxHands ?? this.maxHands);
    if (!Number.isFinite(hands) || hands < 0 || hands > 200) throw new Error('回合数需在 0~200 之间');

    this.smallBlind = sb;
    this.bigBlind = bb;
    this.minBuyIn = bb * 20;
    this.maxBuyIn = bb * 200;
    if (seats > this.maxSeats) this.seats.push(...Array.from({ length: seats - this.maxSeats }, () => null));
    else if (seats < this.maxSeats) this.seats.length = seats;
    this.maxSeats = seats;
    this.turnTimeoutMs = turnSec * 1000;
    this.maxHands = hands;
    this.hooks.emitState();
  }

  // ---------- 大厅 ----------

  takeSeat(playerId: string, seatIndex: number, buyIn: number): void {
    if (this.status !== 'lobby') throw new Error('游戏已开始，只能观战');
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= this.maxSeats) throw new Error('座位无效');
    if (this.seats[seatIndex]) throw new Error('该座位已有玩家');
    if (this.seatOfPlayer(playerId) !== null) throw new Error('你已入座');
    if (!Number.isInteger(buyIn) || buyIn < this.minBuyIn || buyIn > this.maxBuyIn) {
      throw new Error(`买入需在 ${this.minBuyIn} ~ ${this.maxBuyIn} 之间`);
    }
    if (!this.players.has(playerId)) throw new Error('请先加入房间');
    this.seats[seatIndex] = { seatIndex, playerId, stack: buyIn };
    this.hooks.emitState();
  }

  leaveSeat(playerId: string): void {
    const seat = this.seatOfPlayer(playerId);
    if (seat === null) throw new Error('你不在座位上');
    const handRunning = this.engine !== null && !this.engine.isHandEnded;
    if (handRunning && this.isParticipant(seat)) throw new Error('手牌进行中不能离座');
    this.seats[seat] = null;
    this.hooks.emitState();
  }

  // ---------- 游戏控制 ----------

  startGame(playerId: string): void {
    if (playerId !== this.hostId) throw new Error('只有房主可以开始游戏');
    if (this.status !== 'lobby') throw new Error('游戏已开始');
    const seated = this.seats.filter((s): s is Seat => s !== null);
    if (seated.length < 2) throw new Error('至少需要 2 名玩家入座');

    this.status = 'playing';
    this.handNumber = 0;
    this.seq = 0;

    // 开局抽牌定庄：52 张盖牌摊在桌面，由玩家各自点击抽一张，全部抽完统一揭晓
    const deck = new Deck();
    this.dealerDraw = {
      pool: Array.from({ length: 52 }, () => deck.draw()),
      taken: new Map(),
      revealed: false,
      dealerSeat: null,
    };
    this.drawDeadline = Date.now() + this.turnTimeoutMs;
    this.drawTimer = setTimeout(() => this.autoDrawMissing(), this.turnTimeoutMs);
    this.hooks.emitState();
  }

  /** 抽牌定庄：玩家从摊开的牌堆中抽一张（deckIndex = 牌堆/桌面位置索引） */
  drawCard(playerId: string, deckIndex: number): void {
    const dd = this.dealerDraw;
    if (!dd || dd.revealed) throw new Error('当前不在抽牌阶段');
    const seat = this.seatOfPlayer(playerId);
    if (seat === null) throw new Error('观战中不能抽牌');
    if ([...dd.taken.values()].some((t) => t.seatIndex === seat)) throw new Error('你已经抽过牌了');
    if (!Number.isInteger(deckIndex) || deckIndex < 0 || deckIndex >= dd.pool.length) throw new Error('无效的牌');
    if (dd.taken.has(deckIndex)) throw new Error('这张牌已被抽走');
    dd.taken.set(deckIndex, { seatIndex: seat, card: dd.pool[deckIndex] });
    this.emit({ type: 'dealer_draw_pick', seatIndex: seat, deckIndex });
    this.hooks.emitState();
    this.maybeFinishDraw();
  }

  /** 所有在座玩家都抽完后揭晓 */
  private maybeFinishDraw(): void {
    const dd = this.dealerDraw;
    if (!dd || dd.revealed) return;
    const seated = this.seats.filter((s): s is Seat => s !== null).map((s) => s.seatIndex);
    if (seated.length === 0) {
      // 抽牌中所有人离座：取消抽牌，等人重新入座
      this.clearDrawTimer();
      this.dealerDraw = null;
      this.hooks.emitState();
      return;
    }
    const picked = new Set([...dd.taken.values()].map((t) => t.seatIndex));
    if (seated.some((s) => !picked.has(s))) return;
    this.finishDraw();
  }

  /** 揭晓全部抽牌，点数最大者（同点比花色）为庄家，随后开始第一手 */
  private finishDraw(): void {
    const dd = this.dealerDraw;
    if (!dd || dd.revealed) return;
    this.clearDrawTimer();
    dd.revealed = true;
    const draws = [...dd.taken.entries()]
      .map(([deckIndex, t]) => ({ seatIndex: t.seatIndex, deckIndex, card: t.card }))
      .sort((a, b) => a.seatIndex - b.seatIndex);
    let best = draws[0];
    for (const d of draws.slice(1)) {
      if (compareHighCard(d.card, best.card) > 0) best = d;
    }
    this.dealerSeat = best.seatIndex;
    dd.dealerSeat = best.seatIndex;
    this.emit({ type: 'dealer_draw_reveal', draws });
    this.emit({ type: 'dealer_chosen', seatIndex: best.seatIndex });
    this.hooks.emitState();
    this.nextHandTimer = setTimeout(() => this.startHand(), config.dealerDrawPauseMs);
  }

  /** 抽牌超时：为未抽的玩家随机代抽，然后揭晓 */
  private autoDrawMissing(): void {
    const dd = this.dealerDraw;
    if (!dd || dd.revealed) return;
    const seated = this.seats.filter((s): s is Seat => s !== null).map((s) => s.seatIndex);
    const picked = new Set([...dd.taken.values()].map((t) => t.seatIndex));
    const remaining = dd.pool.map((_, i) => i).filter((i) => !dd.taken.has(i));
    for (const seatIndex of seated) {
      if (picked.has(seatIndex)) continue;
      const idx = remaining.splice(randomInt(remaining.length), 1)[0];
      dd.taken.set(idx, { seatIndex, card: dd.pool[idx] });
      this.emit({ type: 'dealer_draw_pick', seatIndex, deckIndex: idx });
    }
    this.hooks.emitState();
    this.finishDraw();
  }

  private clearDrawTimer(): void {
    if (this.drawTimer) clearTimeout(this.drawTimer);
    this.drawTimer = null;
    this.drawDeadline = null;
  }

  /** 结算阶段：亮出/盖上自己的一张底牌（亮出时全员可见，可再盖上） */
  showCard(playerId: string, cardIndex: number): void {
    if (!this.engine || !this.engine.isHandEnded) throw new Error('手牌结束后才能亮牌');
    const seat = this.seatOfPlayer(playerId);
    if (seat === null) throw new Error('你不在本手牌中');
    this.engine.toggleHole(seat, cardIndex);
    this.hooks.emitState();
  }

  stopGame(playerId: string): void {
    if (playerId !== this.hostId) throw new Error('只有房主可以结束游戏');
    if (this.status !== 'playing') throw new Error('游戏未开始');
    if (this.engine && !this.engine.isHandEnded) throw new Error('手牌进行中，请等本手结束');
    if (this.nextHandTimer) {
      clearTimeout(this.nextHandTimer);
      this.nextHandTimer = null;
    }
    this.clearDrawTimer();
    this.status = 'lobby';
    this.engine = null;
    this.dealerDraw = null;
    this.dealerSeat = -1;
    this.hooks.emitState();
  }

  action(playerId: string, action: 'fold' | 'check' | 'call' | 'raise', amount?: number): void {
    if (!this.engine || this.engine.isHandEnded) throw new Error('当前没有进行中的手牌');
    const seat = this.seatOfPlayer(playerId);
    if (seat === null || this.engine.actingSeat !== seat) throw new Error('还没轮到你行动');
    this.processEvents(this.engine.act(seat, action, amount));
  }

  rebuy(playerId: string, amount: number): void {
    const seat = this.seatOfPlayer(playerId);
    if (seat === null) throw new Error('你不在座位上');
    const handRunning = this.engine !== null && !this.engine.isHandEnded;
    if (handRunning && this.isParticipant(seat)) throw new Error('手牌进行中不能补码，请等本手结束');
    if (!Number.isInteger(amount) || amount < this.minBuyIn) throw new Error(`补码至少 ${this.minBuyIn}`);
    const seatObj = this.seats[seat]!;
    if (seatObj.stack + amount > this.maxBuyIn) throw new Error(`筹码上限 ${this.maxBuyIn}`);
    seatObj.stack += amount;
    this.hooks.emitState();
  }

  /** 房主确认后开始下一手（不再自动开始） */
  nextHand(playerId: string): void {
    if (playerId !== this.hostId) throw new Error('只有房主可以开始下一手');
    if (this.status !== 'playing') throw new Error('游戏未在进行中');
    if (!this.engine || !this.engine.isHandEnded) throw new Error('当前没有已结束的手牌');
    const ready = this.continuablePlayers();
    if (ready.length < 2) throw new Error('不足 2 名玩家有筹码，无法开始下一手');
    this.startHand();
  }

  // ---------- 手牌流程 ----------

  private startHand(): void {
    this.nextHandTimer = null;
    if (this.status !== 'playing') return;
    const participants = this.seats.filter(
      (s): s is Seat => s !== null && s.stack > 0 && this.players.get(s.playerId)?.connected === true,
    );
    if (participants.length < 2) {
      this.hooks.emitState(); // 等人补码/重连；房主可结束游戏
      return;
    }
    // dealer 在参与者中轮转；第一手沿用抽牌结果，之后每手顺时针移动
    const idx = participants.map((s) => s.seatIndex);
    if (this.handNumber > 0 && idx.includes(this.dealerSeat)) {
      this.dealerSeat = nextSeat(idx, this.dealerSeat);
    }
    if (!idx.includes(this.dealerSeat)) this.dealerSeat = idx[0];
    this.dealerDraw = null;
    this.handNumber++;
    this.handFinalized = false;
    this.engine = new HandEngine(
      participants.map((s) => ({
        seatIndex: s.seatIndex,
        playerId: s.playerId,
        nickname: this.players.get(s.playerId)!.nickname,
        stack: s.stack,
        connected: true,
      })),
      this.dealerSeat,
      { smallBlind: this.smallBlind, bigBlind: this.bigBlind, handNumber: this.handNumber },
    );
    const events = this.engine.start();
    // 私信底牌
    for (const s of participants) {
      this.hooks.emitToPlayer(s.playerId, { holeCards: this.engine.getHoleCards(s.seatIndex) });
    }
    this.processEvents(events);
  }

  private processEvents(events: EngineEvent[]): void {
    for (const ev of events) this.emit(ev);
    this.hooks.emitState();

    if (this.engine?.isHandEnded) {
      this.finalizeHand();
      return;
    }
    this.setTurnTimer();
    this.sendYourTurn();
  }

  private finalizeHand(): void {
    if (this.handFinalized || !this.engine) return;
    this.handFinalized = true;
    this.clearTurnTimer();

    // 写回筹码；处理淘汰与断线逐出
    const stacks = this.engine.finalStacks();
    for (const [seatIndex, stack] of stacks) {
      const seat = this.seats[seatIndex];
      if (!seat) continue;
      seat.stack = stack;
      if (stack === 0) {
        // 筹码归零：保留座位（显示"已淘汰"），可在大厅补码后继续；
        // 不补码则自动排除在下一手之外
        this.emit({ type: 'player_eliminated', seatIndex });
      }
    }
    // 断线超时/中途离开者：手牌结束后移出房间
    for (const pid of [...this.forfeited]) this.removePlayer(pid);

    // 自动结算：可继续的玩家不足 2 人，或已达到房间回合数上限 → 本局游戏结束回大厅
    if (this.continuablePlayers().length < 2) {
      this.status = 'lobby';
    } else if (this.maxHands > 0 && this.handNumber >= this.maxHands) {
      this.status = 'lobby';
    }
    this.hooks.emitState();
  }

  /** 有筹码且在线、可以继续下一手的玩家座位 */
  private continuablePlayers(): Seat[] {
    return this.seats.filter(
      (s): s is Seat => s !== null && s.stack > 0 && this.players.get(s.playerId)?.connected === true,
    );
  }

  // ---------- 回合计时 ----------

  private setTurnTimer(): void {
    this.clearTurnTimer();
    if (!this.engine || this.engine.actingSeat === null) return;
    const actingOnline = this.actingPlayerOnline();
    // 离线/已离开的玩家：不等完整回合计时，轮到即快速自动弃牌
    const delay = actingOnline ? this.turnTimeoutMs : 800;
    this.turnDeadline = Date.now() + delay;
    this.turnTimer = setTimeout(() => this.onTurnTimeout(), delay);
  }

  private actingPlayerOnline(): boolean {
    if (!this.engine || this.engine.actingSeat === null) return false;
    const seat = this.seats[this.engine.actingSeat];
    if (!seat) return false;
    const p = this.players.get(seat.playerId);
    return (p?.connected ?? false) && !this.forfeited.has(seat.playerId);
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.turnDeadline = null;
  }

  private onTurnTimeout(): void {
    if (!this.engine || this.engine.actingSeat === null || this.engine.isHandEnded) return;
    const seat = this.engine.actingSeat;
    const legal = this.engine.legalActions(seat);
    // 离线玩家一律弃牌；在线超时玩家能过牌则过牌，否则弃牌
    const online = this.actingPlayerOnline();
    const action = online && legal.canCheck ? 'check' : 'fold';
    try {
      this.processEvents(this.engine.act(seat, action));
    } catch {
      /* 手牌可能已结束 */
    }
  }

  private sendYourTurn(): void {
    if (!this.engine || this.engine.actingSeat === null || this.engine.isHandEnded) return;
    const seat = this.engine.actingSeat;
    const seatObj = this.seats[seat];
    if (!seatObj) return;
    const p = this.players.get(seatObj.playerId);
    if (!p?.connected) return;
    const legal = this.engine.legalActions(seat, this.turnDeadline ?? 0);
    this.hooks.emitToPlayer(p.id, { yourTurn: legal });
  }

  // ---------- 工具 ----------

  private seatOfPlayer(playerId: string): number | null {
    for (const s of this.seats) if (s?.playerId === playerId) return s.seatIndex;
    return null;
  }

  private isParticipant(seatIndex: number): boolean {
    if (!this.engine || seatIndex < 0) return false;
    return this.engine.seatIndexes.includes(seatIndex);
  }

  private emit(ev: EngineEvent): void {
    this.hooks.emitEvent({ ...ev, seq: ++this.seq } as GameEvent);
  }

  private clearDisconnectTimer(playerId: string): void {
    const t = this.disconnectTimers.get(playerId);
    if (t) clearTimeout(t);
    this.disconnectTimers.delete(playerId);
  }

  // ---------- 状态导出 ----------

  buildState(forPlayerId: string | null): RoomState {
    const engineSeats = this.engine
      ? new Map(this.engine.toSeatStates(forPlayerId).map((s) => [s.seatIndex, s]))
      : null;

    const seats: (SeatState | null)[] = this.seats.map((seat, i) => {
      if (!seat) return null;
      const p = this.players.get(seat.playerId);
      const es = engineSeats?.get(i);
      if (es) return { ...es, connected: p?.connected ?? false };
      return {
        seatIndex: i,
        playerId: seat.playerId,
        nickname: p?.nickname ?? '???',
        connected: p?.connected ?? false,
        stack: seat.stack,
        bet: 0,
        committed: 0,
        holeCards: null,
        hasFolded: false,
        isAllIn: false,
        hasActed: false,
        isDealer: this.status === 'playing' && i === this.dealerSeat,
        lastAction: null,
      };
    });

    const seatedIds = new Set(this.seats.filter(Boolean).map((s) => s!.playerId));
    const spectators = [...this.players.values()]
      .filter((p) => !seatedIds.has(p.id))
      .map((p) => ({ playerId: p.id, nickname: p.nickname }));

    let game: GameState | null = null;
    if (this.dealerDraw) {
      const dd = this.dealerDraw;
      game = {
        phase: 'dealer_draw',
        handNumber: 0,
        dealerSeat: this.dealerSeat,
        smallBlind: this.smallBlind,
        bigBlind: this.bigBlind,
        board: [],
        pots: [],
        potTotal: 0,
        currentBet: 0,
        minRaiseTo: 0,
        actingSeat: null,
        turnDeadline: null,
        dealerDraw: {
          available: dd.pool.map((_, i) => i).filter((i) => !dd.taken.has(i)),
          draws: [...dd.taken.entries()].map(([deckIndex, t]) => ({
            seatIndex: t.seatIndex,
            deckIndex,
            card: dd.revealed ? t.card : null,
          })),
          deadline: this.drawDeadline,
          dealerSeat: dd.dealerSeat,
        },
        showdown: null,
        awards: null,
        revealedHoles: [],
      };
    } else if (this.engine) {
      game = { ...this.engine.toPublicState(), turnDeadline: this.turnDeadline };
    } else if (this.status === 'playing') {
      game = {
        phase: 'idle',
        handNumber: this.handNumber,
        dealerSeat: this.dealerSeat,
        smallBlind: this.smallBlind,
        bigBlind: this.bigBlind,
        board: [],
        pots: [],
        potTotal: 0,
        currentBet: 0,
        minRaiseTo: 0,
        actingSeat: null,
        turnDeadline: null,
        dealerDraw: null,
        showdown: null,
        awards: null,
        revealedHoles: [],
      };
    }

    return {
      code: this.code,
      status: this.status,
      hostId: this.hostId,
      seats,
      spectators,
      maxSeats: this.maxSeats,
      minBuyIn: this.minBuyIn,
      maxBuyIn: this.maxBuyIn,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      turnTimeoutMs: this.turnTimeoutMs,
      maxHands: this.maxHands,
      game,
    };
  }
}
