import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initHistoryRecorder, recordHistory } from '../src/history/recorder.js';
import type { HistoryRecord } from '../src/history/types.js';

describe('对局记录 JSONL 落盘', () => {
  it('初始化目录、按房间分文件追加，逐行可解析且字段完整', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'th-history-'));
    try {
      initHistoryRecorder(dir);

      const gameStart: HistoryRecord = {
        ts: 0,
        matchId: 'm1',
        roomCode: 'ABCDEF',
        type: 'game_start',
        hostId: 'p1',
        hostNickname: 'lzc',
        smallBlind: 10,
        bigBlind: 20,
        maxSeats: 9,
        minBuyIn: 400,
        maxBuyIn: 4000,
        maxHands: 0,
        seats: [{ seatIndex: 0, playerId: 'p1', nickname: 'lzc', isBot: false, stack: 2000 }],
      };

      const handResult: HistoryRecord = {
        ts: 1,
        matchId: 'm1',
        roomCode: 'ABCDEF',
        type: 'hand_result',
        handNumber: 1,
        dealerSeat: 0,
        board: ['As', '9h', 'Th', 'Qs', 'Ad'],
        potTotal: 1525,
        seats: [
          {
            seatIndex: 0,
            playerId: 'p1',
            nickname: 'lzc',
            isBot: false,
            holeCards: ['Ah', 'Kh'],
            committed: 715,
            won: 1450,
            net: 735,
            handName: '三条',
            folded: false,
          },
          {
            seatIndex: 1,
            playerId: 'p2',
            nickname: 'bb',
            isBot: false,
            holeCards: ['7h', '9c'],
            committed: 790,
            won: 75,
            net: -715,
            handName: '两对',
            folded: false,
          },
        ],
      };

      recordHistory(gameStart);
      recordHistory(handResult);

      // 不同房间写入不同文件
      recordHistory({ ...gameStart, roomCode: 'OTHER1' });

      const lines = readFileSync(path.join(dir, 'ABCDEF.jsonl'), 'utf8').trimEnd().split('\n');
      expect(lines).toHaveLength(2);

      const parsed = lines.map((l) => JSON.parse(l) as HistoryRecord);
      expect(parsed[0].type).toBe('game_start');
      expect(parsed[1].type).toBe('hand_result');
      if (parsed[1].type === 'hand_result') {
        expect(parsed[1].seats[1].net).toBe(-715);
        expect(parsed[1].seats[1].holeCards).toEqual(['7h', '9c']);
        expect(parsed[1].board).toHaveLength(5);
      }

      const otherLines = readFileSync(path.join(dir, 'OTHER1.jsonl'), 'utf8').trimEnd().split('\n');
      expect(otherLines).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});