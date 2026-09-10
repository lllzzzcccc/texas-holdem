import { randomInt } from 'node:crypto';
import type { RoomSummary } from '@th/shared';
import { Room } from './Room.js';
import { config } from '../config.js';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 0/O/1/I/L

export class RoomManager {
  private rooms = new Map<string, Room>();
  private sweeper: NodeJS.Timeout;
  /** 房间增删时回调（网关用来推送大厅列表） */
  onChange: (() => void) | null = null;

  constructor() {
    this.sweeper = setInterval(() => this.sweep(), 10_000);
    this.sweeper.unref();
  }

  get size(): number {
    return this.rooms.size;
  }

  listSummaries(): RoomSummary[] {
    return [...this.rooms.values()].map((r) => r.summary());
  }

  generateCode(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = '';
      for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('房间号生成失败，请重试');
  }

  add(room: Room): void {
    this.rooms.set(room.code, room);
    this.onChange?.();
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  remove(code: string): void {
    const room = this.rooms.get(code);
    if (room) {
      room.destroy();
      this.rooms.delete(code);
      this.onChange?.();
    }
  }

  /** 清理无人房间 */
  private sweep(): void {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (room.emptySince !== null && now - room.emptySince > config.emptyRoomTtlMs) {
        this.remove(room.code);
      }
    }
  }

  destroy(): void {
    clearInterval(this.sweeper);
    for (const code of [...this.rooms.keys()]) this.remove(code);
  }
}
