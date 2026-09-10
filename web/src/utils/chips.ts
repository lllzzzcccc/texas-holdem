/** 筹码面额与配色（从大到小贪心拆分） */
const DENOMS: { value: number; color: string; edge: string }[] = [
  { value: 1000, color: '#f4d03f', edge: '#b7950b' },
  { value: 500, color: '#8e44ad', edge: '#6c3483' },
  { value: 100, color: '#212f3c', edge: '#566573' },
  { value: 25, color: '#1e8449', edge: '#145a32' },
  { value: 10, color: '#2874a6', edge: '#1a5276' },
  { value: 5, color: '#c0392b', edge: '#922b21' },
  { value: 1, color: '#ecf0f1', edge: '#b2babb' },
];

export interface ChipPiece {
  value: number;
  color: string;
  edge: string;
}

/** 把金额拆成最多 max 枚筹码（视觉上大面额优先，零头合并到最小面额） */
export function chipsFor(amount: number, max = 7): ChipPiece[] {
  const pieces: ChipPiece[] = [];
  let rest = Math.max(0, Math.round(amount));
  for (const d of DENOMS) {
    while (rest >= d.value && pieces.length < max) {
      pieces.push({ value: d.value, color: d.color, edge: d.edge });
      rest -= d.value;
    }
    if (pieces.length >= max) break;
  }
  // 超出 max 时最后一枚代表剩余全部
  if (rest > 0 && pieces.length > 0) {
    const smallest = DENOMS[DENOMS.length - 1];
    pieces[pieces.length - 1] = { value: rest + pieces[pieces.length - 1].value, color: smallest.color, edge: smallest.edge };
  }
  return pieces;
}

export function formatChips(n: number): string {
  return n.toLocaleString('zh-CN');
}
