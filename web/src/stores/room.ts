import { defineStore } from 'pinia';
import type { CardStr, CreateRoomOptions, GameEvent, LegalActions, RoomState, RoomSummary } from '@th/shared';
import { EV } from '@th/shared';
import { emitAck, saveNickname, savePlayerId, socket } from '../socket';
import { enqueueGameEvent, queueIdle, resetAnimation } from '../anim/queue';
import { sfx } from '../utils/sound';

export interface Banner {
  id: number;
  title: string;
  sub?: string;
}

export interface LogEntry {
  id: number;
  text: string;
  kind: 'divider' | 'action' | 'info' | 'win';
  /** 动作主体昵称（渲染为彩色 tab） */
  name?: string;
}

interface ApiErr {
  code: string;
  message: string;
}

function isErr(r: unknown): r is ApiErr {
  return typeof r === 'object' && r !== null && 'code' in r && 'message' in r;
}

let bannerId = 0;
let logId = 0;
let socketWired = false;

export const useRoomStore = defineStore('room', {
  state: () => ({
    room: null as RoomState | null,
    playerId: '' as string,
    joined: false,
    joining: false,
    holeCards: [] as CardStr[],
    yourTurn: null as LegalActions | null,
    socketConnected: false,
    errorMsg: '' as string,
    banners: [] as Banner[],
    lobbyRooms: [] as RoomSummary[],
    /** 本手对局记录（右侧边栏展示） */
    actionLog: [] as LogEntry[],

    // ---- 动画闸门（由动画队列推进；room:state 全量刷新不直接改变这些）----
    /** 已翻开的公共牌数量 */
    boardCount: 0,
    /** 已发到牌的座位（渲染底牌/牌背） */
    dealtSeats: [] as number[],
    /** 是否已亮出摊牌 */
    showdownRevealed: false,
    /** 抽牌定庄：已抽到牌（牌已飞到座位）的座位 */
    drawnSeats: [] as number[],
    /** 抽牌定庄：是否已揭晓比大小（翻开所有抽牌） */
    drawRevealed: false,
    /** 是否显示获胜横幅 */
    awardsVisible: false,
    /** 当前手牌标识（用于 hand_start 时重置闸门） */
    currentHand: 0,
  }),

  getters: {
    mySeat(state): number | null {
      if (!state.room) return null;
      const s = state.room.seats.find((x) => x?.playerId === state.playerId);
      return s ? s.seatIndex : null;
    },
    isHost(state): boolean {
      return !!state.room && state.room.hostId === state.playerId;
    },
    isSeated(): boolean {
      return this.mySeat !== null;
    },
    isSpectator(state): boolean {
      return !!state.room && state.room.status === 'playing' && this.mySeat === null;
    },
    seatedCount(state): number {
      return state.room?.seats.filter(Boolean).length ?? 0;
    },
    canStart(): boolean {
      return this.isHost && this.room?.status === 'lobby' && this.seatedCount >= 2;
    },
    phase(state): string {
      return state.room?.game?.phase ?? 'lobby';
    },
    /** 座位号 → 展示位置（不旋转：玩家就坐在自己选定的座位上） */
    displayPos(): (seatIndex: number) => number {
      return (seatIndex: number) => seatIndex;
    },
    seatAtDisplay(): (pos: number) => import('@th/shared').SeatState | null {
      return (pos: number) => this.room?.seats[pos] ?? null;
    },
    inviteUrl(state): string {
      if (!state.room) return '';
      return `${location.origin}${location.pathname}#/room/${state.room.code}`;
    },
    /** 我是否已被淘汰（座位保留但 0 筹码且游戏进行中） */
    eliminated(): boolean {
      if (!this.room || this.mySeat === null) return false;
      const s = this.room.seats[this.mySeat];
      return this.room.status === 'playing' && !!s && s.stack === 0 && !this.room.game;
    },
  },

  actions: {
    wireSocket() {
      if (socketWired) return;
      socketWired = true;
      socket.on('connect', () => {
        this.socketConnected = true;
      });
      socket.on('disconnect', () => {
        this.socketConnected = false;
      });
      socket.on(EV.RoomState, (state: RoomState) => {
        this.room = state;
        // 手牌号变化且动画队列空闲：说明是重连/快照而非事件流 → 直接跳到最终画面
        const hand = state.game?.handNumber ?? 0;
        if (hand > 0 && this.currentHand !== hand && queueIdle()) {
          this.snapGates(state);
        }
        this.syncGatesCaps(state);
      });
      socket.on(EV.GameEvent, (ev: GameEvent) => {
        enqueueGameEvent(ev, this);
      });
      socket.on(EV.HoleCards, (p: { cards: CardStr[] }) => {
        this.holeCards = p.cards;
      });
      socket.on(EV.YourTurn, (legal: LegalActions) => {
        this.yourTurn = legal;
        sfx.yourTurn();
      });
      socket.on(EV.LobbyRooms, (rooms: RoomSummary[]) => {
        this.lobbyRooms = rooms;
      });
      this.socketConnected = socket.connected;
    },

    /** 订阅大厅房间列表（进入主页时调用，服务端会立即推送一次） */
    subscribeLobby() {
      if (socket.connected) socket.emit(EV.LobbySubscribe, {});
      else socket.once('connect', () => socket.emit(EV.LobbySubscribe, {}));
    },

    unsubscribeLobby() {
      socket.emit(EV.LobbyUnsubscribe, {});
    },

    /** 直接跳到最终画面（加入/重连/快照恢复时调用） */
    snapGates(state: RoomState) {
      const g = state.game;
      this.boardCount = g?.board.length ?? 0;
      this.showdownRevealed = !!g?.showdown;
      this.awardsVisible = !!g?.awards;
      this.dealtSeats = state.seats.filter((s) => s?.holeCards).map((s) => s!.seatIndex);
      this.drawnSeats = g?.dealerDraw?.draws.map((d) => d.seatIndex) ?? [];
      this.drawRevealed = !!g?.dealerDraw?.dealerSeat;
      this.currentHand = g?.handNumber ?? 0;
    },

    /** 闸门上界与状态对齐（防止动画遗漏导致卡在不一致画面） */
    syncGatesCaps(state: RoomState) {
      const g = state.game;
      if (!g) return;
      if (this.boardCount > g.board.length) this.boardCount = g.board.length;
      if (!g.showdown) this.showdownRevealed = false;
      if (!g.awards) this.awardsVisible = false;
      if (!g.dealerDraw) {
        this.drawnSeats = [];
        this.drawRevealed = false;
      } else {
        // 状态里已抽的座位必须已显示抽牌（补全可能因动画遗漏的座位）
        for (const d of g.dealerDraw.draws) {
          if (!this.drawnSeats.includes(d.seatIndex)) this.drawnSeats.push(d.seatIndex);
        }
        if (g.dealerDraw.dealerSeat !== null) this.drawRevealed = true;
      }
    },

    resetForRoom() {
      this.room = null;
      this.joined = false;
      this.holeCards = [];
      this.yourTurn = null;
      this.banners = [];
      this.actionLog = [];
      resetAnimation();
      this.boardCount = 0;
      this.dealtSeats = [];
      this.showdownRevealed = false;
      this.drawnSeats = [];
      this.drawRevealed = false;
      this.awardsVisible = false;
      this.currentHand = 0;
    },

    toast(message: string) {
      this.errorMsg = message;
      setTimeout(() => {
        if (this.errorMsg === message) this.errorMsg = '';
      }, 3000);
    },

    banner(title: string, sub?: string, durationMs = 1800) {
      const id = ++bannerId;
      this.banners.push({ id, title, sub });
      setTimeout(() => {
        this.banners = this.banners.filter((b) => b.id !== id);
      }, durationMs);
    },

    /** 追加对局记录 */
    log(text: string, kind: LogEntry['kind'] = 'info', name?: string) {
      this.actionLog.push({ id: ++logId, text, kind, name });
      if (this.actionLog.length > 80) this.actionLog.splice(0, this.actionLog.length - 80);
    },

    clearLog() {
      this.actionLog = [];
    },

    async createRoom(nickname: string, options?: CreateRoomOptions): Promise<string | null> {
      saveNickname(nickname);
      const r = await emitAck<
        { nickname: string; options?: CreateRoomOptions },
        { roomCode: string; playerId: string; state: RoomState } | ApiErr
      >(EV.RoomCreate, { nickname, options });
      if (isErr(r)) {
        this.toast(r.message);
        return null;
      }
      // 保存房主身份令牌：进入房间页时将凭此重连为同一玩家（否则会以新玩家重复加入）
      this.playerId = r.playerId;
      savePlayerId(r.roomCode, r.playerId);
      return r.roomCode;
    },

    async joinRoom(roomCode: string, nickname: string, playerId?: string): Promise<boolean> {
      this.joining = true;
      saveNickname(nickname);
      const r = await emitAck<
        { roomCode: string; nickname: string; playerId?: string },
        { playerId: string; roomCode: string; state: RoomState } | ApiErr
      >(EV.RoomJoin, { roomCode: roomCode.toUpperCase(), nickname, playerId });
      this.joining = false;
      if (isErr(r)) {
        this.toast(r.message);
        return false;
      }
      this.playerId = r.playerId;
      savePlayerId(r.roomCode, r.playerId);
      this.resetForRoom();
      this.room = r.state;
      this.snapGates(r.state);
      this.joined = true;
      return true;
    },

    async takeSeat(seatIndex: number, buyIn: number): Promise<boolean> {
      const r = await emitAck<{ seatIndex: number; buyIn: number }, { ok: true } | ApiErr>(EV.LobbyTakeSeat, {
        seatIndex,
        buyIn,
      });
      if (isErr(r)) {
        this.toast(r.message);
        return false;
      }
      return true;
    },

    async leaveSeat() {
      const r = await emitAck<Record<string, never>, { ok: true } | ApiErr>(EV.LobbyLeaveSeat, {});
      if (isErr(r)) this.toast(r.message);
    },

    async startGame() {
      const r = await emitAck<Record<string, never>, { ok: true } | ApiErr>(EV.GameStart, {});
      if (isErr(r)) this.toast(r.message);
    },

    async stopGame() {
      const r = await emitAck<Record<string, never>, { ok: true } | ApiErr>(EV.GameStop, {});
      if (isErr(r)) this.toast(r.message);
    },

    /** 房主解散房间（全员将被请出） */
    async dissolveRoom() {
      const r = await emitAck<Record<string, never>, { ok: true } | ApiErr>(EV.RoomDissolve, {});
      if (isErr(r)) this.toast(r.message);
    },

    /** 房主修改房间设置 */
    async configureRoom(options: CreateRoomOptions): Promise<boolean> {
      const r = await emitAck<{ options: CreateRoomOptions }, { ok: true } | ApiErr>(EV.RoomConfigure, { options });
      if (isErr(r)) {
        this.toast(r.message);
        return false;
      }
      return true;
    },

    async nextHand() {
      const r = await emitAck<Record<string, never>, { ok: true } | ApiErr>(EV.GameNextHand, {});
      if (isErr(r)) this.toast(r.message);
    },

    async rebuy(amount: number) {
      const r = await emitAck<{ amount: number }, { ok: true } | ApiErr>(EV.GameRebuy, { amount });
      if (isErr(r)) this.toast(r.message);
    },

    act(action: 'fold' | 'check' | 'call' | 'raise', amount?: number) {
      this.yourTurn = null; // 立即收起面板，防重复点击
      socket.emit(EV.GameAction, { action, amount }, (r: { ok: true } | ApiErr) => {
        if (isErr(r)) this.toast(r.message);
      });
    },

    /** 抽牌定庄：从摊开的牌堆抽一张 */
    drawCard(deckIndex: number) {
      socket.emit(EV.GameDrawCard, { deckIndex }, (r: { ok: true } | ApiErr) => {
        if (isErr(r)) this.toast(r.message);
      });
    },

    /** 结算阶段亮出自己的一张底牌 */
    showCard(cardIndex: number) {
      socket.emit(EV.GameShowCard, { cardIndex }, (r: { ok: true } | ApiErr) => {
        if (isErr(r)) this.toast(r.message);
      });
    },

    async leaveRoom() {
      try {
        await emitAck<Record<string, never>, { ok: true } | ApiErr>(EV.RoomLeave, {});
      } finally {
        this.resetForRoom();
      }
    },
  },
});
