/** 一次 AI 决策：单个合法动作（单发请求，无多轮/工具调用） */
export interface BotDecision {
  action: 'fold' | 'check' | 'call' | 'raise';
  /** 仅 raise 需要：加注「到」的目标总额（含本街已下注），整数 */
  amount?: number;
}

/** Anthropic Messages API 连接配置（来自 config.ai） */
export interface AiConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
}
