export interface Contribution {
  seatIndex: number;
  amount: number;
  folded: boolean;
}

export interface BuiltPot {
  amount: number;
  /** 有资格赢取该池的座位（未弃牌且投入达到该层级） */
  eligibleSeats: number[];
}

/**
 * 根据各玩家整手牌的累计投入构建主池/边池。
 * 弃牌玩家的投入计入池（死钱）但不具备赢取资格。
 * 相邻层级若 eligible 相同会合并为一个池。
 */
export function buildPots(contributions: Contribution[]): BuiltPot[] {
  const active = contributions.filter((c) => c.amount > 0);
  if (active.length === 0) return [];

  const levels = [...new Set(active.map((c) => c.amount))].sort((a, b) => a - b);
  const pots: BuiltPot[] = [];
  let prev = 0;

  for (const level of levels) {
    const contributors = active.filter((c) => c.amount >= level);
    const amount = (level - prev) * contributors.length;
    const eligibleSeats = contributors
      .filter((c) => !c.folded)
      .map((c) => c.seatIndex)
      .sort((a, b) => a - b);
    prev = level;
    if (amount <= 0) continue;
    const last = pots[pots.length - 1];
    if (last && last.eligibleSeats.join(',') === eligibleSeats.join(',')) {
      last.amount += amount;
    } else if (eligibleSeats.length > 0) {
      pots.push({ amount, eligibleSeats });
    } else {
      // 所有人（含弃牌者）都参与的层但无人有资格？不会发生：最高层必有未弃牌者。
      // 防御：并入上一池
      if (pots.length > 0) pots[pots.length - 1].amount += amount;
      else pots.push({ amount, eligibleSeats });
    }
  }
  return pots;
}

/**
 * 把一个池分给赢家（可能平分）。余数筹码从 dealer 顺时针方向第一家赢家开始逐个分配。
 * @returns seatIndex -> 分得金额
 */
export function splitPot(
  potAmount: number,
  winnerSeats: number[],
  dealerSeat: number,
): Map<number, number> {
  const result = new Map<number, number>();
  if (winnerSeats.length === 0) return result;
  const share = Math.floor(potAmount / winnerSeats.length);
  let remainder = potAmount - share * winnerSeats.length;
  for (const s of winnerSeats) result.set(s, share);

  // 余数：从 dealer 顺时针（座位号增大绕环）最近的赢家开始，每人 1 筹码
  const sorted = [...winnerSeats].sort((a, b) => a - b);
  let idx = sorted.findIndex((s) => s > dealerSeat);
  if (idx === -1) idx = 0;
  while (remainder > 0) {
    const seat = sorted[idx % sorted.length];
    result.set(seat, (result.get(seat) ?? 0) + 1);
    remainder--;
    idx++;
  }
  return result;
}
