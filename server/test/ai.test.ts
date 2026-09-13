import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDecision, requestDecision } from '../src/ai/client.js';
import { buildPrompt, type PromptContext } from '../src/ai/prompt.js';
import type { AiConfig } from '../src/ai/types.js';

const cfg: AiConfig = {
  apiKey: 'test-key',
  model: 'claude-sonnet-5',
  baseUrl: 'https://api.anthropic.com',
  timeoutMs: 5000,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeContext(): PromptContext {
  return {
    handNumber: 1,
    smallBlind: 10,
    bigBlind: 20,
    phase: 'preflop',
    board: [],
    potTotal: 30,
    currentBet: 20,
    dealerSeat: 0,
    mySeat: 2,
    holeCards: ['As', 'Td'],
    seats: [
      { seatIndex: 0, nickname: '玩家0', stack: 980, bet: 10, committed: 10, hasFolded: false, isAllIn: false, isDealer: true, lastAction: '小盲 10' },
      { seatIndex: 1, nickname: '玩家1', stack: 980, bet: 20, committed: 20, hasFolded: false, isAllIn: false, isDealer: false, lastAction: '大盲 20' },
      { seatIndex: 2, nickname: 'AI·1', stack: 1000, bet: 0, committed: 0, hasFolded: false, isAllIn: false, isDealer: false, lastAction: null },
    ],
    legal: {
      canFold: true,
      canCheck: false,
      callAmount: 20,
      canRaise: true,
      minRaiseTo: 40,
      maxRaiseTo: 1000,
      pot: 30,
      turnDeadline: 0,
    },
  };
}

describe('ai/prompt 提示词组装', () => {
  it('包含自己的底牌（含花色与点数描述）', () => {
    const { user } = buildPrompt(makeContext());
    expect(user).toContain('A♠黑桃');
    expect(user).toContain('10♦方块');
  });

  it('包含阶段、盲注、合法动作与加注范围', () => {
    const { user } = buildPrompt(makeContext());
    expect(user).toContain('preflop');
    expect(user).toContain('小盲 10 / 大盲 20');
    expect(user).toContain('加注范围（加注到）：40 ~ 1000');
  });

  it('system 提示词要求只输出 JSON', () => {
    const { system } = buildPrompt(makeContext());
    expect(system).toContain('JSON');
    expect(system).toContain('fold');
  });
});

describe('ai/client 决策解析', () => {
  it('解析标准决策 JSON', () => {
    expect(parseDecision('{"action":"call"}')).toEqual({ action: 'call' });
    expect(parseDecision('{"action":"raise","amount":120}')).toEqual({ action: 'raise', amount: 120 });
  });

  it('容忍模型包裹在说明/代码块里', () => {
    expect(parseDecision('我决定：```json\n{"action":"fold"}\n```')).toEqual({ action: 'fold' });
  });

  it('非法动作/金额抛错', () => {
    expect(() => parseDecision('{"action":"allin"}')).toThrow();
    expect(() => parseDecision('{"action":"raise","amount":"many"}')).toThrow();
    expect(() => parseDecision('没有 JSON')).toThrow();
  });
});

describe('ai/client 请求', () => {
  function okFetch(text: string) {
    return vi.fn(async () => ({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text }] }),
    }));
  }

  it('成功返回并解析决策', async () => {
    vi.stubGlobal('fetch', okFetch('{"action":"check"}'));
    await expect(requestDecision({ system: 's', user: 'u' }, cfg)).resolves.toEqual({ action: 'check' });
  });

  it('未配置 apiKey 直接抛错', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(requestDecision({ system: 's', user: 'u' }, { ...cfg, apiKey: '' })).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });

  it('首次失败后重试成功', async () => {
    const f = vi
      .fn()
      .mockRejectedValueOnce(new Error('超时'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ content: [{ type: 'text', text: '{"action":"fold"}' }] }) });
    vi.stubGlobal('fetch', f);
    await expect(requestDecision({ system: 's', user: 'u' }, cfg)).resolves.toEqual({ action: 'fold' });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('两次都失败则抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('网络错误')));
    await expect(requestDecision({ system: 's', user: 'u' }, cfg)).rejects.toThrow();
  });
});
