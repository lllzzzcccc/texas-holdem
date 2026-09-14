import { mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import type { HistoryRecord } from './types.js';

let dir: string | null = null;

/**
 * 初始化对局记录落盘目录（幂等；未初始化时 recordHistory 为空操作，便于测试环境忽略）。
 */
export function initHistoryRecorder(historyDir: string): void {
  mkdirSync(historyDir, { recursive: true });
  dir = historyDir;
}

/**
 * 追加一条 JSONL 记录到 `<dir>/<roomCode>.jsonl`。
 * 写失败只告警、绝不抛错——记录不能影响对局主流程。
 */
export function recordHistory(rec: HistoryRecord): void {
  if (dir === null) return;
  try {
    appendFileSync(path.join(dir, `${rec.roomCode}.jsonl`), JSON.stringify(rec) + '\n', 'utf8');
  } catch (e) {
    console.warn('[history] 写入失败（忽略，不影响对局）', e);
  }
}