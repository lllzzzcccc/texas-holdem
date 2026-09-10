export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:3000',
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
} as const;
