import { randomInt, randomUUID } from 'node:crypto';
import type {
  CardStr,
  CreateRoomOptions,
  DanmakuPayload,
  EmojiThrowPayload,
  GameEvent,
  GameState,
  LegalActions,
  RoomConfigChange,
  RoomState,
  SeatState,
} from '@th/shared';
import {
  BOT_BLUFF_POT_MAX,
  BOT_BLUFF_POT_MIN,
  BOT_BLUFF_RATE_MAX,
  BOT_BLUFF_RATE_MIN,
  DANMAKU_MAX_LEN,
  DANMAKU_STYLES,
  EMOJI_PRESETS,
  EV,
} from '@th/shared';
import { Deck, compareHighCard } from '../engine/deck.js';
import { HandEngine, type EngineEvent } from '../engine/HandEngine.js';
import { nextSeat } from '../engine/positions.js';
import { config } from '../config.js';
import { requestDecision } from '../ai/client.js';
import { buildPrompt, type PromptContext } from '../ai/prompt.js';
import type { BotDecision } from '../ai/types.js';
import { recordHistory } from '../history/recorder.js';
import type { HistoryPayload, HistoryRecord } from '../history/types.js';

export interface Player {
  id: string;
  nickname: string;
  socketId: string | null;
  connected: boolean;
  joinedAt: number;
  /** 是否为房主放置的 AI 玩家（socketId 恒为 null，由服务端代为行动） */
  isBot: boolean;
  /** AI 诈唬频率（0~1，仅 AI 有值，放置时由房主指定或随机） */
  bluffRate?: number;
  /** AI 诈唬注码占底池比例（0~1，仅 AI 有值） */
  bluffPotPct?: number;
}

interface Seat {
  seatIndex: number;
  playerId: string;
  /** 手牌间的持久筹码（手牌进行中以引擎为准） */
  stack: number;
}

/** 规范化房间密码：undefined/null/'' → 无密码；其余必须是 4 位数字 */
function normalizeRoomPassword(pw: string | undefined | null): string | null {
  if (pw === undefined || pw === null || pw === '') return null;
  if (!/^\d{4}$/.test(pw)) throw new Error('房间密码需为 4 位数字');
  return pw;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** 随机生成一套 AI 诈唬风格（房主不可指定，创建时在合理区间内随机） */
function randomBluffStyle(): { bluffRate: number; bluffPotPct: number } {
  return {
    bluffRate: round2(BOT_BLUFF_RATE_MIN + Math.random() * (BOT_BLUFF_RATE_MAX - BOT_BLUFF_RATE_MIN)),
    bluffPotPct: round2(BOT_BLUFF_POT_MIN + Math.random() * (BOT_BLUFF_POT_MAX - BOT_BLUFF_POT_MIN)),
  };
}

/** Room 对外输出（由 gateway 实现，桥接 socket.io） */
export interface RoomHooks {
  /** 广播带 seq 的游戏事件 */
  emitEvent(ev: GameEvent): void;
  /** 向每个在线玩家广播其个性化房间状态 */
  emitState(): void;
  /** 私信某玩家：底牌 / 轮到其行动 */
  emitToPlayer(playerId: string, payload: { holeCards?: CardStr[]; yourTurn?: LegalActions }): void;
  /** 向全房间广播一条无 seq 的即时消息（表情投掷、弹幕等） */
  broadcast(event: string, payload: unknown): void;
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
  /** 私密房间：不出现在大厅列表，只能凭房间号/邀请链接加入 */
  isPrivate: boolean;
  /** 加入密码（4 位数字，null = 无密码）。永不出现在 RoomState 中 */
  password: string | null;

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
  /** AI 玩家编号计数器（生成 playerId/nickname 用） */
  private botSeq = 0;
  private nextHandTimer: NodeJS.Timeout | null = null;
  private handFinalized = false;
  private disconnectTimers = new Map<string, NodeJS.Timeout>();
  private forfeited = new Set<string>();
  /** 输光玩家补码决策：待决座位 + 截止时间戳 */
  private rebuyPending: number[] = [];
  private rebuyDeadline: number | null = null;
  private rebuyTimer: NodeJS.Timeout | null = null;
  /** finalizeHand 结算中标记：抑制 reconcile 的自动判定，避免与统一结算逻辑冲突 */
  private reconcilingHand = false;

  // ---------- 对局记录 ----------
  /** 本房间对局记录的唯一标识（随机 UUID，跨手稳定） */
  private matchId = randomUUID();
  /** 是否已记录 room_ended（幂等，保证每场对局只记一次终局快照） */
  private matchEndRecorded = false;
  /** 每手发牌后：座位 → 两张底牌（供 hand_result 落盘，含弃牌者） */
  private holeCardsBySeat = new Map<number, CardStr[]>();

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
    // 0 = 不限时；其余钳制到 10~120 秒
    this.turnTimeoutMs = turnSec === 0 ? 0 : Math.min(120, Math.max(10, Number.isFinite(turnSec) ? turnSec : 30)) * 1000;
    const hands = Math.floor(options.maxHands ?? 0);
    this.maxHands = Math.min(200, Math.max(0, Number.isFinite(hands) ? hands : 0));
    this.isPrivate = options.isPrivate === true;
    this.password = normalizeRoomPassword(options.password);
    // 买入范围跟随盲注：20BB ~ 200BB
    this.minBuyIn = this.bigBlind * 20;
    this.maxBuyIn = this.bigBlind * 200;

    this.seats = Array.from({ length: this.maxSeats }, () => null);
  }

  destroy(): void {
    this.clearTurnTimer();
    this.clearDrawTimer();
    if (this.nextHandTimer) clearTimeout(this.nextHandTimer);
    if (this.rebuyTimer) clearTimeout(this.rebuyTimer);
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

  /** 该 playerId 是否已是房间成员（重连免密判断用） */
  hasPlayer(playerId: string): boolean {
    return this.players.has(playerId);
  }

  /** 校验加入密码（无密码时恒通过） */
  checkPassword(pw: string | undefined): boolean {
    return this.password === null || this.password === pw;
  }

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
    // 昵称查重：新玩家不能与房间内现有成员重名（忽略大小写与首尾空格；
    // 本人重连/同 socket 复用走上面的分支，不受此限）
    const norm = (s: string) => s.trim().toLowerCase();
    if ([...this.players.values()].some((p) => norm(p.nickname) === norm(nickname))) {
      throw new Error('该昵称已被房间内其他玩家使用，请换一个昵称');
    }
    const player: Player = {
      id: playerId && !this.players.has(playerId) ? playerId : randomUUID(),
      nickname,
      socketId,
      connected: true,
      joinedAt: Date.now(),
      isBot: false,
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

    if (this.players.size > 0 && ![...this.players.values()].some((x) => x.connected && !x.isBot)) {
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
    // 补码决策中有人被移除：立即结清其待决座位
    if (seat !== null) this.resolveRebuySeat(seat);
    // 抽牌阶段有人离开：剩余玩家若都已抽完则直接揭晓
    if (this.dealerDraw && !this.dealerDraw.revealed) this.maybeFinishDraw();
    // 没有任何玩家 = 没有房主，立即销毁，不等空房倒计时
    if (this.players.size === 0) {
      this.hooks.destroyRoom();
      return;
    }
    // 只剩 AI（没有任何真人，含观战者）：AI 不能当房主，直接销毁，不留悬空的房主
    if (![...this.players.values()].some((p) => !p.isBot)) {
      this.hooks.destroyRoom();
      return;
    }
    if (![...this.players.values()].some((x) => x.connected && !x.isBot)) this.emptySince = Date.now();
    // 检查当前游戏是否还能继续，避免任何阶段卡死
    this.reconcilePlayability();
  }

  /** 房主踢人：立即移出房间。手牌进行中的在座玩家不可踢（避免引擎状态错乱） */
  kickPlayer(byPlayerId: string, targetId: string): Player {
    if (byPlayerId !== this.hostId) throw new Error('只有房主可以踢人');
    if (targetId === this.hostId) throw new Error('不能踢出自己');
    const target = this.players.get(targetId);
    if (!target) throw new Error('该玩家不在房间中');
    const seat = this.seatOfPlayer(targetId);
    const handRunning = this.engine !== null && !this.engine.isHandEnded;
    if (handRunning && seat !== null && this.isParticipant(seat)) {
      throw new Error('该玩家手牌进行中，请等本手结束后再踢');
    }
    this.removePlayer(targetId);
    this.hooks.emitState();
    return target;
  }

  /** 房主离开/被移除时：按加入顺序转移给下一位在线玩家（AI 不接任房主） */
  private transferHost(): void {
    const next = [...this.players.values()]
      .filter((p) => p.connected && !p.isBot && p.id !== this.hostId)
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
    // 0 = 不限时；其余需在 10~120 秒之间
    const turnValid = Number.isFinite(turnSec) && (turnSec === 0 || (turnSec >= 10 && turnSec <= 120));
    if (!turnValid) throw new Error('出牌时间需为「不限时」或 10~120 秒');

    const hands = Math.floor(options.maxHands ?? this.maxHands);
    if (!Number.isFinite(hands) || hands < 0 || hands > 200) throw new Error('回合数需在 0~200 之间');

    const nextPrivate = options.isPrivate === undefined ? this.isPrivate : options.isPrivate === true;
    const nextPassword = options.password === undefined ? this.password : normalizeRoomPassword(options.password);

    // 记录实际变化的项，用于向全房间广播「房主已更新房间配置」通知
    const changes: RoomConfigChange[] = [];
    if (sb !== this.smallBlind || bb !== this.bigBlind) changes.push({ label: '盲注', value: `${sb}/${bb}` });
    if (seats !== this.maxSeats) changes.push({ label: '最大座位', value: `${seats} 人` });
    if (turnSec * 1000 !== this.turnTimeoutMs) {
      changes.push({ label: '出牌时间', value: turnSec === 0 ? '不限时' : `${turnSec} 秒` });
    }
    if (hands !== this.maxHands) changes.push({ label: '回合数', value: hands === 0 ? '不限' : `${hands} 手` });
    if (nextPrivate !== this.isPrivate) changes.push({ label: '房间类型', value: nextPrivate ? '私密' : '公共' });
    if (options.password !== undefined && nextPassword !== this.password) {
      changes.push({ label: '加入密码', value: nextPassword ? '已设置' : '已清除' });
    }

    this.isPrivate = nextPrivate;
    this.password = nextPassword;
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
    if (changes.length > 0) this.hooks.broadcast(EV.RoomConfigured, { changes });
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

  /** 房主在空座放置 AI 玩家并为其买入筹码（仅大厅阶段可用）；诈唬风格由服务端随机指定 */
  addBot(playerId: string, seatIndex: number, buyIn: number): void {
    if (playerId !== this.hostId) throw new Error('只有房主可以放置 AI 玩家');
    if (this.status !== 'lobby') throw new Error('游戏已开始，只能观战');
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= this.maxSeats) throw new Error('座位无效');
    if (this.seats[seatIndex]) throw new Error('该座位已有玩家');
    if (!Number.isInteger(buyIn) || buyIn < this.minBuyIn || buyIn > this.maxBuyIn) {
      throw new Error(`买入需在 ${this.minBuyIn} ~ ${this.maxBuyIn} 之间`);
    }
    const seq = ++this.botSeq;
    const botId = `bot-${seq}`;
    const style = randomBluffStyle();
    // AI 昵称不与真人重名（AI·1 与「AI·1」规范一致，忽略大小写比较不会误伤）
    this.players.set(botId, {
      id: botId,
      nickname: `AI·${seq}`,
      socketId: null,
      connected: true,
      joinedAt: Date.now(),
      isBot: true,
      ...style,
    });
    this.seats[seatIndex] = { seatIndex, playerId: botId, stack: buyIn };
    console.log(
      `[AI] 房主放置 AI 于座位${seatIndex}：${botId} 买入${buyIn}，随机诈唬频率=${style.bluffRate}，诈唬注码=${style.bluffPotPct}`,
    );
    this.hooks.emitState();
  }

  leaveSeat(playerId: string): void {
    const seat = this.seatOfPlayer(playerId);
    if (seat === null) throw new Error('你不在座位上');
    const handRunning = this.engine !== null && !this.engine.isHandEnded;
    if (handRunning && this.isParticipant(seat)) throw new Error('手牌进行中不能离座');
    this.seats[seat] = null;
    this.resolveRebuySeat(seat);
    this.reconcilePlayability();
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
    this.matchEndRecorded = false;

    // 开局快照落盘（对局记录）
    this.record({
      type: 'game_start',
      hostId: this.hostId,
      hostNickname: this.players.get(this.hostId)?.nickname ?? '',
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      maxSeats: this.maxSeats,
      minBuyIn: this.minBuyIn,
      maxBuyIn: this.maxBuyIn,
      maxHands: this.maxHands,
      seats: seated.map((s) => ({
        seatIndex: s.seatIndex,
        playerId: s.playerId,
        nickname: this.players.get(s.playerId)?.nickname ?? '???',
        isBot: this.players.get(s.playerId)?.isBot ?? false,
        stack: s.stack,
      })),
    });

    // 开局抽牌定庄：摊开 maxSeats+2 张盖牌在桌面，由玩家各自点击抽一张，全部抽完统一揭晓
    const deck = new Deck();
    this.dealerDraw = {
      pool: Array.from({ length: this.maxSeats + 2 }, () => deck.draw()),
      taken: new Map(),
      revealed: false,
      dealerSeat: null,
    };
    // 不限时（turnTimeoutMs = 0）：抽牌阶段不设自动补抽，玩家可从容选择
    if (this.turnTimeoutMs > 0) {
      this.drawDeadline = Date.now() + this.turnTimeoutMs;
      this.drawTimer = setTimeout(() => this.autoDrawMissing(), this.turnTimeoutMs);
    }
    // 房主放置的 AI 自动代抽（避免卡在抽牌阶段等 AI 点击）
    for (const s of seated) {
      const p = this.players.get(s.playerId);
      if (!p?.isBot) continue;
      const dd = this.dealerDraw!;
      const available = dd.pool.map((_, i) => i).filter((i) => !dd.taken.has(i));
      if (available.length === 0) break;
      this.drawCard(p.id, available[randomInt(available.length)]);
    }
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

  /** 结算阶段：房主翻开 AI 玩家的一张底牌（翻出后全员可见） */
  revealBotCard(hostPlayerId: string, seatIndex: number, cardIndex: number): void {
    if (hostPlayerId !== this.hostId) throw new Error('只有房主可以翻开 AI 的牌');
    if (!this.engine || !this.engine.isHandEnded) throw new Error('手牌结束后才能翻牌');
    const seat = this.seats[seatIndex];
    if (!seat) throw new Error('该座位没有玩家');
    const p = this.players.get(seat.playerId);
    if (!p?.isBot) throw new Error('只能翻开 AI 玩家的牌');
    this.engine.toggleHole(seatIndex, cardIndex);
    this.hooks.emitState();
  }

  /** 表情投掷冷却（playerId → 上次投掷时间戳） */
  private lastEmojiAt = new Map<string, number>();
  /** 弹幕冷却（playerId → 上次发送时间戳） */
  private lastDanmakuAt = new Map<string, number>();

  /** 向某座位投掷表情：发送者须在座，目标座位须有人，1s 冷却 */
  throwEmoji(playerId: string, toSeatIndex: number, emoji: string): void {
    const fromSeat = this.seatOfPlayer(playerId);
    if (fromSeat === null) throw new Error('入座后才能投掷表情');
    const target = this.seats[toSeatIndex];
    if (!target) throw new Error('目标座位没有玩家');
    if (!(EMOJI_PRESETS as readonly string[]).includes(emoji)) throw new Error('不支持的表情');
    const now = Date.now();
    if (now - (this.lastEmojiAt.get(playerId) ?? 0) < 1000) throw new Error('投掷太频繁了');
    this.lastEmojiAt.set(playerId, now);
    const payload: EmojiThrowPayload = {
      fromSeatIndex: fromSeat,
      toSeatIndex,
      emoji: emoji as EmojiThrowPayload['emoji'],
      fromNickname: this.players.get(playerId)!.nickname,
      toNickname: this.players.get(target.playerId)?.nickname ?? '',
    };
    this.hooks.broadcast(EV.EmojiThrow, payload);
  }

  /** 发送弹幕：房间内成员（含观战）均可，3s 冷却 */
  sendDanmaku(playerId: string, text: string, style: string): void {
    const player = this.players.get(playerId);
    if (!player) throw new Error('你不在房间中');
    const trimmed = (text ?? '').trim();
    if (!trimmed) throw new Error('弹幕不能为空');
    if (trimmed.length > DANMAKU_MAX_LEN) throw new Error(`弹幕最长 ${DANMAKU_MAX_LEN} 个字符`);
    if (!(DANMAKU_STYLES as readonly string[]).includes(style)) throw new Error('不支持的弹幕样式');
    const now = Date.now();
    if (now - (this.lastDanmakuAt.get(playerId) ?? 0) < 3000) throw new Error('发送太频繁了');
    this.lastDanmakuAt.set(playerId, now);
    const seat = this.seatOfPlayer(playerId);
    const payload: DanmakuPayload = {
      seatIndex: seat,
      nickname: player.nickname,
      text: trimmed,
      style: style as DanmakuPayload['style'],
    };
    this.hooks.broadcast(EV.DanmakuSend, payload);
  }

  stopGame(playerId: string): void {
    if (playerId !== this.hostId) throw new Error('只有房主可以结束游戏');
    // 手牌进行中不可结束；整局已结束（status 已回大厅、仅剩结算面板）时同样可结束清场
    if (this.engine && !this.engine.isHandEnded) throw new Error('手牌进行中，请等本手结束');
    this.resetToLobby();
    this.hooks.broadcast(EV.GameStopped, { message: '房主已结束游戏' });
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
    this.resolveRebuySeat(seat);
    this.hooks.emitState();
  }

  /** 房主确认后开始下一手（不再自动开始） */
  nextHand(playerId: string): void {
    if (playerId !== this.hostId) throw new Error('只有房主可以开始下一手');
    if (this.status !== 'playing') throw new Error('游戏未在进行中');
    if (!this.engine || !this.engine.isHandEnded) throw new Error('当前没有已结束的手牌');
    if (this.rebuyPending.length > 0) throw new Error('请等待输光玩家作出选择后再开始');
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
      this.reconcilePlayability(); // 确实无法凑齐 2 人时整局结束，避免卡在「等人」
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
    // 私信底牌；同时记录完整底牌（分析用，含后续弃牌者）
    this.holeCardsBySeat.clear();
    const dealtHoleCards: { seatIndex: number; cards: [CardStr, CardStr] }[] = [];
    for (const s of participants) {
      const cards = this.engine.getHoleCards(s.seatIndex);
      this.hooks.emitToPlayer(s.playerId, { holeCards: cards });
      const pair = cards as [CardStr, CardStr];
      this.holeCardsBySeat.set(s.seatIndex, pair);
      dealtHoleCards.push({ seatIndex: s.seatIndex, cards: pair });
    }
    this.processEvents(events);
    this.record({
      type: 'deal',
      handNumber: this.handNumber,
      dealerSeat: this.dealerSeat,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      holeCards: dealtHoleCards,
    });
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
    this.scheduleBotTurn();
  }

  private finalizeHand(): void {
    if (this.handFinalized || !this.engine) return;
    this.handFinalized = true;
    this.clearTurnTimer();

    // 每手结算汇总落盘（在写回筹码、移除输光 AI 之前，确保昵称/底牌完整）
    this.recordHandResult();

    // 写回筹码；处理淘汰与断线逐出
    const stacks = this.engine.finalStacks();
    for (const [seatIndex, stack] of stacks) {
      const seat = this.seats[seatIndex];
      if (!seat) continue;
      seat.stack = stack;
      if (stack === 0) {
        // 筹码归零：保留座位（前端不再显示「已淘汰」），可在大厅补码后继续；
        // 不补码则自动排除在下一手之外
        this.emit({ type: 'player_eliminated', seatIndex });
      }
    }
    // 断线超时/中途离开者：手牌结束后移出房间（结算期间抑制 reconcile 自动判定）
    this.reconcilingHand = true;
    for (const pid of [...this.forfeited]) this.removePlayer(pid);
    this.reconcilingHand = false;

    // 输光的 AI：自动离座并移除（bot 无法做「补码/离开」抉择，不进补码决策）
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i];
      if (!s || s.stack !== 0) continue;
      if (!this.players.get(s.playerId)?.isBot) continue;
      this.seats[i] = null;
      this.players.delete(s.playerId);
    }

    // 输光的在座玩家（stack 归零且仍在线、且非 AI），下一手前需决定「买入继续 / 离开」
    const busted = this.seats
      .map((s, i) => ({ s, i }))
      .filter(
        ({ s }) =>
          s !== null &&
          s.stack === 0 &&
          this.players.get(s.playerId)?.connected === true &&
          !(this.players.get(s.playerId)?.isBot ?? false),
      )
      .map(({ i }) => i);

    if (this.maxHands > 0 && this.handNumber >= this.maxHands) {
      // 回合数上限 → 整局结束（不等补码决策）
      this.status = 'lobby';
    } else if (busted.length > 0) {
      // 有输光玩家 → 进入补码决策阶段，全员等待，决策后再判定是否整局结束
      this.startRebuyDecision(busted);
    } else if (this.continuablePlayers().length < 2) {
      // 无输光但可继续玩家不足 2 人（如中途断线被移出）→ 整局结束
      this.status = 'lobby';
    }
    // 若本手触发整局结束（maxHands 到顶 / 可续玩家不足），记终局快照
    this.recordRoomEnd();
    this.hooks.emitState();
  }

  // ---------- 输光补码决策 ----------

  /** 进入补码决策：记录待决座位，30s 未操作自动离席 */
  private startRebuyDecision(seats: number[]): void {
    this.rebuyPending = [...seats];
    this.rebuyDeadline = Date.now() + config.rebuyDecisionMs;
    if (this.rebuyTimer) clearTimeout(this.rebuyTimer);
    this.rebuyTimer = setTimeout(() => this.onRebuyTimeout(), config.rebuyDecisionMs);
  }

  /** 某个待决座位已解决（补码或离席）：全部解决后统一判定是否整局结束 */
  private resolveRebuySeat(seatIndex: number): void {
    if (!this.rebuyPending.includes(seatIndex)) return;
    this.rebuyPending = this.rebuyPending.filter((s) => s !== seatIndex);
    if (this.rebuyPending.length === 0) this.finishRebuyDecision();
  }

  /** 补码决策结束：仍不足 2 名可继续玩家 → 整局结束（前端弹出「结束本局」） */
  private finishRebuyDecision(): void {
    if (this.rebuyTimer) {
      clearTimeout(this.rebuyTimer);
      this.rebuyTimer = null;
    }
    this.rebuyDeadline = null;
    this.rebuyPending = [];
    if (this.continuablePlayers().length < 2) {
      this.status = 'lobby';
    }
    this.recordRoomEnd();
    this.hooks.emitState();
  }

  /** 决策超时：仍未操作的输光玩家自动离席 */
  private onRebuyTimeout(): void {
    this.rebuyTimer = null;
    for (const seat of [...this.rebuyPending]) {
      const s = this.seats[seat];
      if (s && s.stack === 0) this.seats[seat] = null;
    }
    this.finishRebuyDecision();
  }

  /** 回到未开始游戏状态：清掉牌局引擎/抽牌与各类计时器，保留在座玩家与持分 */
  private resetToLobby(): void {
    this.clearTurnTimer();
    this.clearDrawTimer();
    if (this.nextHandTimer) {
      clearTimeout(this.nextHandTimer);
      this.nextHandTimer = null;
    }
    if (this.rebuyTimer) {
      clearTimeout(this.rebuyTimer);
      this.rebuyTimer = null;
    }
    this.rebuyPending = [];
    this.rebuyDeadline = null;
    this.status = 'lobby';
    this.engine = null;
    this.dealerDraw = null;
    this.dealerSeat = -1;
    this.handFinalized = false;
    this.recordRoomEnd();
    this.hooks.emitState();
  }

  /** 有筹码且在线、可以继续下一手的玩家座位 */
  private continuablePlayers(): Seat[] {
    return this.seats.filter(
      (s): s is Seat => s !== null && s.stack > 0 && this.players.get(s.playerId)?.connected === true,
    );
  }

  /** 仍有筹码的座位（含断线但未移出者——他们可能重连回来） */
  private seatedWithChips(): Seat[] {
    return this.seats.filter((s): s is Seat => s !== null && s.stack > 0);
  }

  /**
   * 有玩家离开/离席/断线移除后，检查当前对局是否还能继续；无法继续则整局结束。
   * 抽牌中 → 重新判断能否完成；补码决策中 → 交给决策结果；手牌中 → 引擎自行推进；
   * 无手牌且不足 2 名有筹码玩家 → 整局结束，避免任何阶段卡死。
   */
  private reconcilePlayability(): void {
    if (this.reconcilingHand) return; // finalizeHand 结算中，由其统一判定
    if (this.dealerDraw && !this.dealerDraw.revealed) {
      this.maybeFinishDraw();
      return;
    }
    if (this.rebuyPending.length > 0) return;
    if (this.engine !== null && !this.engine.isHandEnded) return;
    if (this.status !== 'playing') return;
    if (this.seatedWithChips().length < 2) {
      this.status = 'lobby';
      // 抽牌已结束却凑不齐 2 人：清掉抽牌状态，前端回到干净大厅，避免卡在抽牌画面
      this.clearDrawTimer();
      this.dealerDraw = null;
      this.dealerSeat = -1;
      this.recordRoomEnd();
    }
  }

  // ---------- 回合计时 ----------

  private setTurnTimer(): void {
    this.clearTurnTimer();
    if (!this.engine || this.engine.actingSeat === null) return;
    // AI 玩家：不挂真人倒计时（AI 有自己的请求超时 + 兜底），避免 onTurnTimeout 抢跑
    const actingSeat = this.engine.actingSeat;
    const acting = this.seats[actingSeat];
    if (acting && this.players.get(acting.playerId)?.isBot) return;
    const actingOnline = this.actingPlayerOnline();
    // 离线/已离开的玩家：轮到即快速自动弃牌（不限时模式下同样适用，避免断线卡住整局）
    if (!actingOnline) {
      this.turnDeadline = Date.now() + 800;
      this.turnTimer = setTimeout(() => this.onTurnTimeout(), 800);
      return;
    }
    // 不限时（turnTimeoutMs = 0）：在线玩家不设倒计时，可无限思考
    if (this.turnTimeoutMs <= 0) {
      this.turnDeadline = null;
      return;
    }
    this.turnDeadline = Date.now() + this.turnTimeoutMs;
    this.turnTimer = setTimeout(() => this.onTurnTimeout(), this.turnTimeoutMs);
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

  // ---------- AI 玩家行动 ----------

  /** 轮到 AI 时异步发起决策（不阻塞 socket 事件循环） */
  private scheduleBotTurn(): void {
    if (!this.engine || this.engine.isHandEnded) return;
    const seat = this.engine.actingSeat;
    if (seat === null) return;
    const seatObj = this.seats[seat];
    if (!seatObj) return;
    const p = this.players.get(seatObj.playerId);
    if (!p?.isBot) return;
    void this.runBotAction(seat, seatObj.playerId);
  }

  /** 组装 AI 决策上下文（只含自己底牌 + 公共信息，不泄露他人底牌） */
  private buildBotContext(seat: number, playerId: string): PromptContext {
    const engine = this.engine!;
    const pub = engine.toPublicState();
    const seats = engine.toSeatStates(playerId).map((s) => ({
      seatIndex: s.seatIndex,
      nickname: s.nickname,
      stack: s.stack,
      bet: s.bet,
      committed: s.committed,
      hasFolded: s.hasFolded,
      isAllIn: s.isAllIn,
      isDealer: s.isDealer,
      lastAction: s.lastAction,
    }));
    return {
      handNumber: pub.handNumber,
      smallBlind: pub.smallBlind,
      bigBlind: pub.bigBlind,
      phase: pub.phase,
      board: pub.board,
      potTotal: pub.potTotal,
      currentBet: pub.currentBet,
      dealerSeat: pub.dealerSeat,
      mySeat: seat,
      holeCards: engine.getHoleCards(seat),
      seats,
      legal: engine.legalActions(seat),
    };
  }

  /** 执行 AI 行动：延迟 → 请求模型 → 兜底/合法性纠正 → 复用真人行动路径 */
  private async runBotAction(seat: number, playerId: string): Promise<void> {
    // 观感自然的随机延迟
    const { turnDelayMinMs, turnDelayMaxMs } = config.ai;
    const delay = randomInt(Math.min(turnDelayMinMs, turnDelayMaxMs), Math.max(turnDelayMinMs, turnDelayMaxMs) + 1);
    await new Promise((r) => setTimeout(r, delay));

    if (!this.engine || this.engine.isHandEnded || this.engine.actingSeat !== seat) return;

    const ctx = this.buildBotContext(seat, playerId);
    console.log(
      `[AI] 座位${seat} 开始决策 phase=${ctx.phase} board=[${ctx.board.join(',')}] 底池=${ctx.potTotal} ` +
        `底牌=[${ctx.holeCards.join(',')}] canCheck=${ctx.legal.canCheck} callAmount=${ctx.legal.callAmount} ` +
        `canRaise=${ctx.legal.canRaise} raiseTo=${ctx.legal.minRaiseTo}~${ctx.legal.maxRaiseTo}`,
    );

    let decision: BotDecision | null = null;
    try {
      const prompt = buildPrompt(ctx);
      console.log(`[AI] 座位${seat} 提示词(user):\n${prompt.user}`);
      decision = await requestDecision(prompt, config.ai);
    } catch (e) {
      console.warn(`[AI] 座位${seat} 决策失败，走兜底（过牌/弃牌）: ${e instanceof Error ? e.message : e}`);
      decision = null;
    }

    // 等待模型返回期间牌局可能已变化，行动前重新校验
    if (!this.engine || this.engine.isHandEnded || this.engine.actingSeat !== seat) return;
    const legal = this.engine.legalActions(seat);

    let action: 'fold' | 'check' | 'call' | 'raise';
    let amount: number | undefined;
    if (decision) {
      switch (decision.action) {
        case 'check':
          action = legal.canCheck ? 'check' : 'fold';
          break;
        case 'call':
          action = legal.canCheck ? 'check' : 'call';
          break;
        case 'raise': {
          if (!legal.canRaise) {
            action = legal.canCheck ? 'check' : 'fold';
          } else {
            const raw = decision.amount ?? legal.minRaiseTo;
            action = 'raise';
            amount = Math.min(Math.max(raw, legal.minRaiseTo), legal.maxRaiseTo);
          }
          break;
        }
        default:
          action = 'fold';
      }
    } else {
      action = legal.canCheck ? 'check' : 'fold';
    }

    // 诈唬层：模型偏向保守（尤其爱「过牌」弃打），这里以一定概率把被动过牌转成主动下注诈唬，
    // 让 AI 更有侵略性、更难被读。只在对手少（≤2）、有下注能力时触发。
    // 概率与注码用该 AI 自己的风格（房主放置时指定或随机），缺省回落到全局配置。
    const botStyle = this.players.get(playerId);
    const bluffRate = botStyle?.bluffRate ?? config.ai.bluffRate;
    const bluffPotPct = botStyle?.bluffPotPct ?? config.ai.bluffPotPct;
    const activeOpponents = ctx.seats.filter((s) => s.seatIndex !== seat && !s.hasFolded && !s.isAllIn).length;
    if (action === 'check' && legal.canRaise && activeOpponents <= 2 && Math.random() < bluffRate) {
      const bluffTo = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(ctx.potTotal * bluffPotPct)));
      action = 'raise';
      amount = bluffTo;
      console.log(
        `[AI] 座位${seat} 诈唬：把「过牌」改为加注到 ${bluffTo}（对手数=${activeOpponents}，底池=${ctx.potTotal}，风格=${bluffRate}/${bluffPotPct}）`,
      );
    }

    console.log(`[AI] 座位${seat} 最终行动: ${action}${amount !== undefined ? ` 加注到 ${amount}` : ''}`);
    try {
      this.processEvents(this.engine.act(seat, action, amount));
    } catch (e) {
      // 兜底：能过牌就过牌，否则弃牌
      console.warn(`[AI] act 失败，走兜底: ${e instanceof Error ? e.message : e}`);
      try {
        const l = this.engine.legalActions(seat);
        this.processEvents(this.engine.act(seat, l.canCheck ? 'check' : 'fold'));
      } catch {
        /* 手牌可能已结束 */
      }
    }
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
    // 对局记录：只落盘有分析价值的动作/翻牌/摊牌事件，抽牌等噪音事件跳过
    switch (ev.type) {
      case 'player_action':
        this.record({
          type: 'action',
          handNumber: this.handNumber,
          seatIndex: ev.seatIndex,
          action: ev.action,
          amount: ev.amount,
          betTotal: ev.betTotal,
          stackAfter: ev.stackAfter,
          potTotal: ev.potTotal,
        });
        break;
      case 'street':
        this.record({ type: 'street', handNumber: this.handNumber, street: ev.street, board: ev.board });
        break;
      case 'showdown':
        this.record({ type: 'showdown', handNumber: this.handNumber, results: ev.results });
        break;
    }
  }

  // ---------- 对局记录落盘 ----------

  /** 补全 ts/matchId/roomCode 后追加一条 JSONL 记录（写失败不影响对局） */
  private record(rec: HistoryPayload): void {
    recordHistory({ ts: Date.now(), matchId: this.matchId, roomCode: this.code, ...rec } as HistoryRecord);
  }

  /** 整局终局快照（幂等，只记一次） */
  private recordRoomEnd(): void {
    if (this.matchEndRecorded || this.status !== 'lobby') return;
    this.matchEndRecorded = true;
    this.record({
      type: 'room_ended',
      handNumber: this.handNumber,
      stacks: this.seats
        .filter((s): s is Seat => s !== null)
        .map((s) => ({
          seatIndex: s.seatIndex,
          playerId: s.playerId,
          nickname: this.players.get(s.playerId)?.nickname ?? '???',
          isBot: this.players.get(s.playerId)?.isBot ?? false,
          stack: s.stack,
        })),
    });
  }

  /** 每手结算汇总落盘（分析核心：全量底牌 + 投入/赢得/净盈亏） */
  private recordHandResult(): void {
    if (!this.engine) return;
    const pub = this.engine.toPublicState();
    const awards = new Map((pub.awards ?? []).map((a) => [a.seatIndex, a]));
    const seatStates = new Map(this.engine.toSeatStates(null).map((s) => [s.seatIndex, s]));
    const seats = this.engine.seatIndexes.map((seatIndex) => {
      const ss = seatStates.get(seatIndex);
      const a = awards.get(seatIndex);
      const won = a?.amount ?? 0;
      const committed = ss?.committed ?? 0;
      const seat = this.seats[seatIndex];
      const p = seat ? this.players.get(seat.playerId) : undefined;
      return {
        seatIndex,
        playerId: seat?.playerId ?? ss?.playerId ?? '',
        nickname: p?.nickname ?? ss?.nickname ?? '???',
        isBot: p?.isBot ?? false,
        holeCards: this.holeCardsBySeat.get(seatIndex) ?? [],
        committed,
        won,
        net: won - committed,
        handName: a?.handName ?? null,
        folded: ss?.hasFolded ?? false,
      };
    });
    this.record({
      type: 'hand_result',
      handNumber: this.handNumber,
      dealerSeat: pub.dealerSeat,
      board: pub.board,
      potTotal: pub.potTotal,
      seats,
    });
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
      if (es) {
        return {
          ...es,
          connected: p?.connected ?? false,
          isBot: p?.isBot ?? false,
          ...(p?.isBot ? { bluffRate: p.bluffRate, bluffPotPct: p.bluffPotPct } : {}),
        };
      }
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
        isBot: p?.isBot ?? false,
        ...(p?.isBot ? { bluffRate: p.bluffRate, bluffPotPct: p.bluffPotPct } : {}),
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
          spreadSize: dd.pool.length,
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
      isPrivate: this.isPrivate,
      hasPassword: this.password !== null,
      rebuyDecision:
        this.rebuyPending.length > 0
          ? { seatIndexes: [...this.rebuyPending], deadline: this.rebuyDeadline ?? 0 }
          : null,
      game,
    };
  }
}
