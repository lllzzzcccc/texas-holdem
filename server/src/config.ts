import path from 'node:path';

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:3000',
  /** 对局记录 JSONL 落盘目录（每房间一个 <code>.jsonl） */
  historyDir: process.env.HISTORY_DIR?.trim() || path.resolve(process.cwd(), 'data/history'),
  /** 对局记录保留天数：超过该天数的历史文件会被后台任务自动清除 */
  historyRetentionDays: Number(process.env.HISTORY_RETENTION_DAYS ?? 14),
  /** 每回合行动时限 */
  turnTimeoutMs: Number(process.env.TURN_TIMEOUT_MS ?? 30_000),
  /** 一手结束后自动开下一手的间隔（留给动画播放） */
  nextHandDelayMs: Number(process.env.NEXT_HAND_DELAY_MS ?? 7_000),
  /** 断线宽限期： lobby 中超过该时间未重连则移除座位 */
  disconnectGraceMs: Number(process.env.DISCONNECT_GRACE_MS ?? 60_000),
  /** 房间无人后销毁时间（默认 30 秒：覆盖刷新重连，又不残留空房） */
  emptyRoomTtlMs: Number(process.env.EMPTY_ROOM_TTL_MS ?? 30_000),
  /** 抽牌动画节奏：每张牌间隔 / 翻完后停留 */
  dealerDrawCardMs: Number(process.env.DEALER_DRAW_CARD_MS ?? 700),
  dealerDrawPauseMs: Number(process.env.DEALER_DRAW_PAUSE_MS ?? 2200),
  /** 输光玩家补码/离席决策时限（超时自动离席） */
  rebuyDecisionMs: Number(process.env.REBUY_DECISION_MS ?? 30000),
  /** AI 玩家（房主放置）配置：Anthropic Messages API（用 AI_* 前缀，避免与 Claude Code 的 ANTHROPIC_* 环境变量冲突） */
  ai: {
    apiKey: process.env.AI_API_KEY ?? '',
    model: process.env.AI_MODEL ?? 'claude-sonnet-5',
    baseUrl: process.env.AI_BASE_URL ?? 'https://api.anthropic.com',
    /** 单次决策请求超时（ms） */
    timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 20_000),
    /** AI 行动前的随机延迟区间（ms），观感更自然 */
    turnDelayMinMs: Number(process.env.AI_TURN_DELAY_MIN_MS ?? 800),
    turnDelayMaxMs: Number(process.env.AI_TURN_DELAY_MAX_MS ?? 1500),
    /** 诈唬注入概率：模型选择「过牌」且牌面可下注时，转成主动下注诈唬的比例（0~1） */
    bluffRate: Number(process.env.AI_BLUFF_RATE ?? 0.15),
    /** 诈唬下注规模：占当前底池的比例（0~1，默认 0.6 = 六成池） */
    bluffPotPct: Number(process.env.AI_BLUFF_POT_PCT ?? 0.6),
  },
} as const;
