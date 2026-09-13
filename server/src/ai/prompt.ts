import type { LegalActions } from '@th/shared';

/** 组装提示词所需的牌局快照（只含 AI 自己底牌 + 公共信息，不含他人底牌） */
export interface PromptContext {
  handNumber: number;
  smallBlind: number;
  bigBlind: number;
  /** 当前阶段：preflop / flop / turn / river */
  phase: string;
  /** 公共牌（CardStr 数组，翻前为空） */
  board: string[];
  /** 总底池 */
  potTotal: number;
  /** 本街当前最高注额（跟注需补齐到该值） */
  currentBet: number;
  dealerSeat: number;
  /** 自己的座位号 */
  mySeat: number;
  /** 自己的两张底牌 */
  holeCards: string[];
  /** 各座位公开状态（不含底牌） */
  seats: Array<{
    seatIndex: number;
    nickname: string;
    stack: number;
    bet: number;
    committed: number;
    hasFolded: boolean;
    isAllIn: boolean;
    isDealer: boolean;
    lastAction: string | null;
  }>;
  legal: LegalActions;
}

const SUIT_NAMES: Record<string, string> = { s: '♠黑桃', h: '♥红桃', d: '♦方块', c: '♣梅花' };
const RANK_NAMES: Record<string, string> = {
  '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A',
};

function describeCard(card: string): string {
  const rank = card[0];
  const suit = card[1];
  return `${RANK_NAMES[rank] ?? rank}${SUIT_NAMES[suit] ?? suit}`;
}

function describeCards(cards: string[]): string {
  return cards.map(describeCard).join('、');
}

export function buildPrompt(ctx: PromptContext): { system: string; user: string } {
  const system = [
    '你是一名德州扑克（无限注 Texas Hold\'em）玩家，正在参与一局真实牌局。',
    '你的目标：根据牌局信息，从「弃牌(fold) / 过牌(check) / 跟注(call) / 加注(raise)」中选择一个能最大化期望收益的合法动作。',
    '你不是一台只会按牌力下注的机器，而是一个会读牌、会诈唬、有变化、让对手摸不透的真实玩家。',
    '',
    '基础策略（务必遵守）：',
    '1. 强牌（大对子、AK/AQ、同花连张、已成对/成顺/成花的牌）要主动下注或加注，不要只会跟注或过牌。',
    '2. 弱牌面对下注要果断弃牌；但跟注成本很低时，中等牌力应跟注看牌，不要过度弃牌。',
    '3. 「可以过牌」不等于「应该过牌」：牌力占优且没人下注时，应主动价值下注，而不是盲目过牌。',
    '4. 无限注扑克中进攻通常优于被动：该加注时大胆加注，用加注施压赢下底池。',
    '',
    '诈唬与混合策略（重要——让打法不再机械、更难被读）：',
    '5. 偶尔诈唬：牌力很弱时，若板面干燥（无明显的顺子/同花面）、对手少（最好 1~2 人）、且对手前面表现出软弱（过牌或下小注），可以加注诈唬偷下底池。诈唬要有选择和时机，大约每 5~8 手才做一次，不要每手都诈。',
    '6. 半诈唬：当你持有同花听、顺子听等听牌时，可以下注或加注「半诈唬」——即使现在还没成牌，也能吓跑对手直接赢下底池，成牌后还能赢更大的池。',
    '7. 变化与陷阱：不要每次同样牌力都打同样的注。强牌偶尔慢打（过牌设陷阱），弱牌偶尔诈唬，注码时大时小，让对手无法从你的下注读出你的牌。',
    '8. 诈唬的克制：多人底池（3 人以上）、板面很湿（顺子/同花可能性高）时不要乱诈唬；一旦被对手重注或再加注，拿空气牌要敢于弃牌，不要为了「诈到底」而烧钱。',
    '',
    '输出规则（必须严格遵守）：',
    '1. 只输出一个 JSON 对象，不要输出任何其他文字、解释、代码块标记或 markdown。',
    '2. JSON 格式：{"action":"fold|check|call|raise","amount":<加注到目标额>}',
    '3. action 只能是 fold、check、call、raise 之一。',
    '4. amount 仅在 action 为 raise 时出现，且必须是整数；它表示「加注到」的总注额（含你本街已下注的筹码），必须在 [minRaiseTo, maxRaiseTo] 范围内（见下方合法动作）。',
    '5. fold/check/call 不要带 amount 字段。',
  ].join('\n');

  const seats = ctx.seats
    .map((s) => {
      const me = s.seatIndex === ctx.mySeat ? '（我）' : '';
      const parts: string[] = [
        `座位${s.seatIndex}${me} ${s.nickname}`,
        `筹码${s.stack}`,
        `本街下注${s.bet}`,
        `累计投入${s.committed}`,
      ];
      if (s.isDealer) parts.push('庄家');
      if (s.hasFolded) parts.push('已弃牌');
      else if (s.isAllIn) parts.push('已全下');
      else if (s.lastAction) parts.push(`最近动作:${s.lastAction}`);
      return parts.join('，');
    })
    .join('\n');

  const legal = ctx.legal;
  const legalLines = [
    `当前轮到：座位 ${ctx.mySeat}`,
    `是否可过牌：${legal.canCheck ? '是' : '否'}`,
    `跟注需补：${legal.callAmount}`,
    `是否可加注：${legal.canRaise ? '是' : '否'}`,
  ];
  if (legal.canRaise) {
    legalLines.push(`加注范围（加注到）：${legal.minRaiseTo} ~ ${legal.maxRaiseTo}`);
  }

  const user = [
    `【牌局信息】`,
    `手牌：第 ${ctx.handNumber} 手`,
    `盲注：小盲 ${ctx.smallBlind} / 大盲 ${ctx.bigBlind}`,
    `阶段：${ctx.phase}`,
    `公共牌：${ctx.board.length ? describeCards(ctx.board) : '（尚未发公共牌）'}`,
    `总底池：${ctx.potTotal}`,
    `本街当前最高注额：${ctx.currentBet}`,
    `庄家：座位 ${ctx.dealerSeat}`,
    '',
    `【我的底牌】${describeCards(ctx.holeCards)}`,
    '',
    `【各座位状态】`,
    seats,
    '',
    `【合法动作】`,
    legalLines.join('\n'),
    '',
    `请直接输出你的决策 JSON（只输出 JSON，不要解释）。`,
  ].join('\n');

  return { system, user };
}
