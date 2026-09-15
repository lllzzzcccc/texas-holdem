import { mkdirSync, appendFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
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

/**
 * 清除超过 maxAgeMs 的对局记录文件（按文件最后修改时间判断）。
 * 每房间一个文件，房间对局结束后不再追加，故 mtime 即对局结束时刻。
 * 返回清除的文件数；目录未初始化或出错时返回 0（清理失败只告警，不影响服务）。
 */
export function cleanupHistory(maxAgeMs: number): number {
  if (dir === null) return 0;
  const now = Date.now();
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (e) {
    console.warn('[history] 读取目录失败（忽略）', e);
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const file = path.join(dir, name);
    try {
      if (now - statSync(file).mtimeMs > maxAgeMs) {
        unlinkSync(file);
        removed++;
      }
    } catch (e) {
      console.warn('[history] 清除失败（忽略）', name, e);
    }
  }
  return removed;
}