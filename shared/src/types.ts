/**
 * 牌面字符串：点数(2-9,T,J,Q,K,A) + 花色(s=♠, h=♥, d=♦, c=♣)
 * 例："As" = 黑桃A，"Td" = 方块10。与 pokersolver 格式兼容。
 */
export type CardStr = string;

export type GamePhase =
  | 'idle' // 未开始 / 两手之间
  | 'dealer_draw' // 开局抽牌比大小定庄家
  | 'preflop'
  | 'flop'
  | 'turn'
  | 'river'
  | 'showdown'
  | 'hand_end';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';

export type ActionType = 'fold' | 'check' | 'call' | 'raise' | 'allin';

/** 座位状态（广播给全房间，底牌已脱敏：未公开的牌为 null） */
export interface SeatState {
  seatIndex: number;
  playerId: string;
  nickname: string;
  connected: boolean;
  /** 身后剩余筹码 */
  stack: number;
  /** 当前这一街已下的注 */
  bet: number;
  /** 整手牌累计投入 */
  committed: number;
  /** 底牌：本人可见；他人未摊牌时为 [null, null]；未参与本手为 null */
  holeCards: (CardStr | null)[] | null;
  hasFolded: boolean;
  isAllIn: boolean;
  hasActed: boolean;
  isDealer: boolean;
  /** 最近一次动作展示（如 "跟注 200"），由前端渲染气泡 */
  lastAction: string | null;
  /** 是否为 AI 玩家（由房主放置，服务端代为行动） */
  isBot: boolean;
  /** AI 诈唬风格：诈唬频率 0~1（仅 AI 座位有值） */
  bluffRate?: number;
  /** AI 诈唬风格：诈唬注码占底池比例 0~1（仅 AI 座位有值） */
  bluffPotPct?: number;
}

export interface PotState {
  amount: number;
  /** 有资格赢取该池的座位 */
  eligibleSeats: number[];
}

export interface DealerDrawState {
  /** 牌堆中仍可抽的位置索引（抽牌定庄摊开的盖牌，数量 = maxSeats + 2） */
  available: number[];
  /** 已抽的座位：牌堆索引 + 牌面（全部抽完揭晓前 card 为 null） */
  draws: { seatIndex: number; deckIndex: number; card: CardStr | null }[];
  /** 抽牌截止时间戳（到点未抽由系统代抽） */
  deadline: number | null;
  /** 抽牌结果确定的庄家座位（未定前为 null） */
  dealerSeat: number | null;
  /** 桌面摊开的盖牌总数（供前端决定渲染多少张） */
  spreadSize: number;
}

export interface ShowdownEntry {
  seatIndex: number;
  cards: CardStr[];
  /** 牌型名（中文，如 "两对"） */
  handName: string;
}

export interface PotAward {
  seatIndex: number;
  amount: number;
  handName: string | null;
}

export interface GameState {
  phase: GamePhase;
  handNumber: number;
  dealerSeat: number;
  smallBlind: number;
  bigBlind: number;
  board: CardStr[];
  pots: PotState[];
  potTotal: number;
  currentBet: number;
  /** 当前最小加注到的总额（不是增量） */
  minRaiseTo: number;
  /** 正在行动的座位（无行动时为 null） */
  actingSeat: number | null;
  /** 行动截止时间戳（ms），前端渲染倒计时 */
  turnDeadline: number | null;
  dealerDraw: DealerDrawState | null;
  showdown: ShowdownEntry[] | null;
  awards: PotAward[] | null;
  /** 结算阶段玩家主动亮出的底牌（座位 + 第几张，所有人可见） */
  revealedHoles: { seatIndex: number; cardIndex: number }[];
}

export interface SpectatorInfo {
  playerId: string;
  nickname: string;
}

export interface RoomState {
  code: string;
  status: 'lobby' | 'playing';
  hostId: string;
  seats: (SeatState | null)[];
  spectators: SpectatorInfo[];
  maxSeats: number;
  minBuyIn: number;
  maxBuyIn: number;
  smallBlind: number;
  bigBlind: number;
  /** 回合行动最长时间（ms，0 = 不限时） */
  turnTimeoutMs: number;
  /** 房间回合数上限（0 = 不限） */
  maxHands: number;
  /** 私密房间（不出现在大厅列表，凭邀请加入） */
  isPrivate: boolean;
  /** 是否设置了加入密码（密码本身永不下发） */
  hasPassword: boolean;
  /** 输光玩家的补码决策阶段（非空 = 有玩家正在选择「买入继续 / 离开」，含截止时间戳） */
  rebuyDecision: { seatIndexes: number[]; deadline: number } | null;
  game: GameState | null;
}

/** 创建房间的可选设置 */
export interface CreateRoomOptions {
  smallBlind?: number;
  bigBlind?: number;
  maxSeats?: number;
  /** 回合行动最长时间（秒，0 = 不限时） */
  turnTimeoutSec?: number;
  /** 回合数上限（0 = 不限） */
  maxHands?: number;
  /** 私密房间：不出现在大厅列表，只能凭房主分享的房间号/二维码加入 */
  isPrivate?: boolean;
  /** 加入密码：4 位数字；'' 表示清除密码；undefined 表示不修改 */
  password?: string;
}

/** 服务器下发的合法行动（客户端只渲染，不自行计算规则） */
export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  /** 跟注所需金额（0 表示可过牌） */
  callAmount: number;
  canRaise: boolean;
  /** 加注到的最小/最大总额 */
  minRaiseTo: number;
  maxRaiseTo: number;
  pot: number;
  turnDeadline: number;
}

// ---------- Socket 事件 payload ----------

export interface JoinedPayload {
  playerId: string;
  roomCode: string;
  state: RoomState;
}

export interface HoleCardsPayload {
  cards: CardStr[];
}

/** 游戏动画事件（有序，客户端串行播放动画） */
export type GameEvent =
  | { seq: number; type: 'dealer_draw_pick'; seatIndex: number; deckIndex: number }
  | { seq: number; type: 'dealer_draw_reveal'; draws: { seatIndex: number; deckIndex: number; card: CardStr }[] }
  | { seq: number; type: 'dealer_chosen'; seatIndex: number }
  | { seq: number; type: 'hand_start'; handNumber: number; dealerSeat: number }
  | { seq: number; type: 'post_blind'; seatIndex: number; amount: number; blind: 'sb' | 'bb' }
  | { seq: number; type: 'deal_hole'; seatIndexes: number[] }
  | {
      seq: number;
      type: 'player_action';
      seatIndex: number;
      action: ActionType;
      amount: number; // 本次投入筹码（跟注额/加注增量/all-in 额），fold/check 为 0
      betTotal: number; // 该玩家本街总注
      stackAfter: number;
      potTotal: number;
    }
  | { seq: number; type: 'street'; street: 'flop' | 'turn' | 'river'; cards: CardStr[]; board: CardStr[] }
  | { seq: number; type: 'showdown'; results: ShowdownEntry[] }
  | { seq: number; type: 'pot_award'; awards: PotAward[] }
  | { seq: number; type: 'hand_end'; handNumber: number }
  | { seq: number; type: 'player_eliminated'; seatIndex: number };

export interface ApiError {
  code: string;
  message: string;
}

/** Socket 事件名常量 */
export const EV = {
  // C→S
  RoomCreate: 'room:create',
  RoomJoin: 'room:join',
  RoomLeave: 'room:leave',
  RoomDissolve: 'room:dissolve',
  RoomConfigure: 'room:configure',
  RoomKick: 'room:kick',
  LobbyTakeSeat: 'lobby:takeSeat',
  LobbyLeaveSeat: 'lobby:leaveSeat',
  LobbyAddBot: 'lobby:addBot',
  GameStart: 'game:start',
  GameStop: 'game:stop',
  GameAction: 'game:action',
  GameRebuy: 'game:rebuy',
  GameNextHand: 'game:nextHand',
  GameDrawCard: 'game:drawCard',
  GameShowCard: 'game:showCard',
  EmojiThrow: 'emoji:throw',
  DanmakuSend: 'danmaku:send',
  LobbyList: 'hall:list',
  LobbySubscribe: 'hall:subscribe',
  LobbyUnsubscribe: 'hall:unsubscribe',
  // S→C
  RoomState: 'room:state',
  RoomDissolved: 'room:dissolved',
  RoomKicked: 'room:kicked',
  RoomConfigured: 'room:configured',
  GameStopped: 'game:stopped',
  GameEvent: 'game:event',
  HoleCards: 'game:holeCards',
  YourTurn: 'game:yourTurn',
  LobbyRooms: 'hall:rooms',
} as const;

/** 表情投掷：可选表情预设（服务端校验白名单） */
export const EMOJI_PRESETS = ['😄', '😂', '😍', '😎', '😡', '😭', '👍', '💣', '🎉', '🌹'] as const;
export type EmojiPreset = (typeof EMOJI_PRESETS)[number];

/** 弹幕样式预设（服务端校验白名单） */
export const DANMAKU_STYLES = ['classic', 'gold', 'neon', 'bubble', 'rainbow'] as const;
export type DanmakuStyle = (typeof DANMAKU_STYLES)[number];

/** 弹幕正文最大长度（字符） */
export const DANMAKU_MAX_LEN = 40;

/** AI 诈唬风格的合理区间（服务端创建 AI 时在此范围内随机指定，房主不可调整） */
export const BOT_BLUFF_RATE_MIN = 0.05;
export const BOT_BLUFF_RATE_MAX = 0.4;
export const BOT_BLUFF_POT_MIN = 0.4;
export const BOT_BLUFF_POT_MAX = 0.9;

/** 表情投掷广播载荷（S→C） */
export interface EmojiThrowPayload {
  fromSeatIndex: number;
  toSeatIndex: number;
  emoji: EmojiPreset;
  fromNickname: string;
  toNickname: string;
}

/** 弹幕广播载荷（S→C） */
export interface DanmakuPayload {
  seatIndex: number | null;
  nickname: string;
  text: string;
  style: DanmakuStyle;
}

/** 房主修改房间参数后广播的单项变更 */
export interface RoomConfigChange {
  label: string;
  value: string;
}

/** 房主修改房间参数的广播载荷（S→C，全房间提示） */
export interface RoomConfigNotice {
  changes: RoomConfigChange[];
}

/** 大厅同时容纳的牌桌上限 */
export const LOBBY_MAX_ROOMS = 10;

/** 大厅牌桌摘要（用于房间列表展示） */
export interface RoomSummary {
  code: string;
  status: 'lobby' | 'playing';
  seated: number;
  maxSeats: number;
  spectators: number;
  handNumber: number;
  smallBlind: number;
  bigBlind: number;
  hostNickname: string;
}

export interface ClientToServerEvents {
  [EV.RoomCreate]: (
    p: { nickname: string; options?: CreateRoomOptions },
    cb: (r: JoinedPayload | ApiError) => void,
  ) => void;
  [EV.RoomJoin]: (
    p: { roomCode: string; nickname: string; playerId?: string; password?: string },
    cb: (r: JoinedPayload | ApiError) => void,
  ) => void;
  [EV.RoomLeave]: (p: Record<string, never>, cb?: (r: { ok: true } | ApiError) => void) => void;
  [EV.RoomDissolve]: (p: Record<string, never>, cb?: (r: { ok: true } | ApiError) => void) => void;
  [EV.RoomConfigure]: (p: { options: CreateRoomOptions }, cb: (r: { ok: true } | ApiError) => void) => void;
  /** 房主踢出房间内成员（手牌进行中的在座玩家不可踢） */
  [EV.RoomKick]: (p: { playerId: string }, cb: (r: { ok: true } | ApiError) => void) => void;
  [EV.LobbyTakeSeat]: (p: { seatIndex: number; buyIn: number }, cb: (r: { ok: true } | ApiError) => void) => void;
  [EV.LobbyLeaveSeat]: (p: Record<string, never>, cb?: (r: { ok: true } | ApiError) => void) => void;
  /** 房主在空座放置 AI 玩家并为其买入筹码（诈唬风格由服务端在合理区间内随机指定） */
  [EV.LobbyAddBot]: (p: { seatIndex: number; buyIn: number }, cb: (r: { ok: true } | ApiError) => void) => void;
  [EV.GameStart]: (p: Record<string, never>, cb: (r: { ok: true } | ApiError) => void) => void;
  [EV.GameStop]: (p: Record<string, never>, cb: (r: { ok: true } | ApiError) => void) => void;
  [EV.GameAction]: (
    p: { action: 'fold' | 'check' | 'call' | 'raise'; amount?: number },
    cb: (r: { ok: true } | ApiError) => void,
  ) => void;
  [EV.GameRebuy]: (p: { amount: number }, cb: (r: { ok: true } | ApiError) => void) => void;
  [EV.GameNextHand]: (p: Record<string, never>, cb: (r: { ok: true } | ApiError) => void) => void;
  /** 抽牌定庄：从摊开的牌堆中抽一张（牌堆索引 0~51） */
  [EV.GameDrawCard]: (p: { deckIndex: number }, cb: (r: { ok: true } | ApiError) => void) => void;
  /** 结算阶段亮出自己的一张底牌（0 或 1），亮出后所有人可见 */
  [EV.GameShowCard]: (p: { cardIndex: number }, cb: (r: { ok: true } | ApiError) => void) => void;
  /** 向某个座位投掷表情（点击该座位头像后选择） */
  [EV.EmojiThrow]: (p: { toSeatIndex: number; emoji: string }, cb: (r: { ok: true } | ApiError) => void) => void;
  /** 发送一条弹幕 */
  [EV.DanmakuSend]: (p: { text: string; style: string }, cb: (r: { ok: true } | ApiError) => void) => void;
  [EV.LobbyList]: (p: Record<string, never>, cb: (r: { rooms: RoomSummary[] }) => void) => void;
  [EV.LobbySubscribe]: (p: Record<string, never>) => void;
  [EV.LobbyUnsubscribe]: (p: Record<string, never>) => void;
}

export interface ServerToClientEvents {
  [EV.RoomState]: (state: RoomState) => void;
  [EV.RoomDissolved]: (p: { message: string }) => void;
  [EV.RoomKicked]: (p: { message: string }) => void;
  [EV.RoomConfigured]: (p: RoomConfigNotice) => void;
  [EV.GameStopped]: (p: { message: string }) => void;
  [EV.GameEvent]: (ev: GameEvent) => void;
  [EV.HoleCards]: (p: HoleCardsPayload) => void;
  [EV.YourTurn]: (p: LegalActions) => void;
  [EV.LobbyRooms]: (rooms: RoomSummary[]) => void;
  [EV.EmojiThrow]: (p: EmojiThrowPayload) => void;
  [EV.DanmakuSend]: (p: DanmakuPayload) => void;
}
