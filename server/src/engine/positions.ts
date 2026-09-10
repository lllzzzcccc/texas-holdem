/**
 * 座位顺序与盲注/行动位置计算。
 * "下一家" = 顺时针（座位号增大方向，绕回）。
 */

/** 返回 from 之后（不含 from）下一个在 seatIndexes 中的座位，绕环。 */
export function nextSeat(seatIndexes: number[], from: number): number {
  const sorted = [...seatIndexes].sort((a, b) => a - b);
  for (const s of sorted) if (s > from) return s;
  return sorted[0];
}

export interface BlindSeats {
  smallBlind: number;
  bigBlind: number;
  /** 翻前第一个行动的座位 */
  firstToActPreflop: number;
  /** 翻后第一个行动的座位（相对 dealer） */
  firstToActPostflop: number;
}

/**
 * 计算盲注位置。
 * 3 人及以上：SB = dealer 下一家，BB = SB 下一家，翻前枪口 = BB 下一家。
 * Heads-up（2 人）：dealer 即小盲，翻前 dealer 先行动；翻后 BB（非 dealer）先行动。
 */
export function blindSeats(seatIndexes: number[], dealerSeat: number): BlindSeats {
  if (seatIndexes.length < 2) throw new Error('至少需要 2 名玩家');
  if (seatIndexes.length === 2) {
    const sb = dealerSeat;
    const bb = nextSeat(seatIndexes, dealerSeat);
    return { smallBlind: sb, bigBlind: bb, firstToActPreflop: sb, firstToActPostflop: bb };
  }
  const sb = nextSeat(seatIndexes, dealerSeat);
  const bb = nextSeat(seatIndexes, sb);
  const utg = nextSeat(seatIndexes, bb);
  return { smallBlind: sb, bigBlind: bb, firstToActPreflop: utg, firstToActPostflop: sb };
}
