import type { ActionType, CardStr, Street } from '@th/shared';

/** 每行记录统一携带的基础字段 */
export interface HistoryBase {
  /** 写入时间戳（毫秒） */
  ts: number;
  /** 房间唯一标识（UUID，随房间创建生成，跨手稳定） */
  matchId: string;
  /** 房间号 */
  roomCode: string;
}

/** 座位引用（昵称/身份，常与筹码或底牌并列） */
export interface HistorySeatRef {
  seatIndex: number;
  playerId: string;
  nickname: string;
  isBot: boolean;
}

/**
 * 对局记录（JSONL 每行一个对象）。
 * 覆盖从开局到整局结束的全过程，含所有玩家的每手完整底牌（弃牌者亦然），用于事后分析。
 */
export type HistoryRecord =
  | (HistoryBase & {
      type: 'game_start';
      hostId: string;
      hostNickname: string;
      smallBlind: number;
      bigBlind: number;
      maxSeats: number;
      minBuyIn: number;
      maxBuyIn: number;
      maxHands: number;
      seats: (HistorySeatRef & { stack: number })[];
    })
  | (HistoryBase & {
      type: 'deal';
      handNumber: number;
      dealerSeat: number;
      smallBlind: number;
      bigBlind: number;
      /** 每名参与者两张完整底牌（含后续弃牌者） */
      holeCards: { seatIndex: number; cards: [CardStr, CardStr] }[];
    })
  | (HistoryBase & {
      type: 'action';
      handNumber: number;
      seatIndex: number;
      action: ActionType;
      amount: number;
      betTotal: number;
      stackAfter: number;
      potTotal: number;
    })
  | (HistoryBase & {
      type: 'street';
      handNumber: number;
      street: Street;
      board: CardStr[];
    })
  | (HistoryBase & {
      type: 'showdown';
      handNumber: number;
      results: { seatIndex: number; cards: CardStr[]; handName: string }[];
    })
  | (HistoryBase & {
      type: 'hand_result';
      handNumber: number;
      dealerSeat: number;
      board: CardStr[];
      potTotal: number;
      seats: (HistorySeatRef & {
        holeCards: CardStr[];
        committed: number;
        won: number;
        net: number;
        handName: string | null;
        folded: boolean;
      })[];
    })
  | (HistoryBase & {
      type: 'room_ended';
      handNumber: number;
      stacks: (HistorySeatRef & { stack: number })[];
    });

/** 去掉基础字段后的载荷（由 Room 补全 ts/matchId/roomCode） */
export type HistoryPayload = DistributiveOmit<HistoryRecord, 'ts' | 'matchId' | 'roomCode'>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;