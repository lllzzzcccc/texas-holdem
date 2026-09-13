import type { AiConfig, BotDecision } from './types.js';

export interface RequestPrompt {
  system: string;
  user: string;
}

/** 从模型返回文本中提取并校验决策 JSON（只做结构校验，额度范围由 Room 侧再校验） */
export function parseDecision(text: string): BotDecision {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI 未返回 JSON');
  let obj: unknown;
  try {
    obj = JSON.parse(m[0]);
  } catch {
    throw new Error('AI 返回的不是合法 JSON');
  }
  const o = obj as { action?: unknown; amount?: unknown };
  const { action } = o;
  if (action !== 'fold' && action !== 'check' && action !== 'call' && action !== 'raise') {
    throw new Error(`AI 返回了非法动作: ${String(action)}`);
  }
  if (action === 'raise') {
    if (typeof o.amount !== 'number' || !Number.isInteger(o.amount) || o.amount <= 0) {
      throw new Error('AI 加注金额无效');
    }
    return { action, amount: o.amount };
  }
  return { action };
}

async function postOnce(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`AI 接口返回 ${res.status}`);
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((c) => c.type === 'text')?.text;
    if (!text) throw new Error('AI 接口未返回文本');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 单次 Messages API 决策请求：失败/超时重试 1 次，仍失败则抛错（由 Room 走兜底）。
 * 未配置 apiKey 时直接抛错，避免发出无意义的请求。
 */
export async function requestDecision(prompt: RequestPrompt, cfg: AiConfig): Promise<BotDecision> {
  if (!cfg.apiKey) throw new Error('AI 未配置 API Key');
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/v1/messages`;
  const headers = {
    'x-api-key': cfg.apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
  const body = {
    model: cfg.model,
    // 需给「思考(thinking) + JSON 文本」留足空间：过小会把思考块截断在输出 JSON 之前
    max_tokens: 512,
    // DeepSeek 推理模型默认输出 thinking 块；扑克决策无需推理，直接关掉以获得纯 JSON 文本
    thinking: { type: 'disabled' },
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await postOnce(url, headers, body, cfg.timeoutMs);
      console.log(`[AI] 模型原始返回（第 ${attempt + 1} 次）:`, text.trim());
      const d = parseDecision(text);
      console.log(`[AI] 解析后的决策:`, JSON.stringify(d));
      return d;
    } catch (e) {
      console.warn(`[AI] 第 ${attempt + 1} 次解析/请求失败:`, e instanceof Error ? e.message : e);
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('AI 请求失败');
}
