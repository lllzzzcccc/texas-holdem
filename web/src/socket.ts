import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@th/shared';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// 同源连接：开发环境由 Vite 代理到 :3000，生产由 Nginx 在 /texas-holdem 前缀下反代
export const socket: AppSocket = io({ autoConnect: true, path: '/texas-holdem/socket.io' });

// ---------- 身份持久化 ----------

const NICKNAME_KEY = 'th_nickname';
const IDS_KEY = 'th_player_ids'; // roomCode -> playerId

export function savedNickname(): string {
  return localStorage.getItem(NICKNAME_KEY) ?? '';
}

export function saveNickname(nickname: string): void {
  localStorage.setItem(NICKNAME_KEY, nickname);
}

export function savedPlayerId(roomCode: string): string | undefined {
  try {
    const map = JSON.parse(localStorage.getItem(IDS_KEY) ?? '{}') as Record<string, string>;
    return map[roomCode];
  } catch {
    return undefined;
  }
}

export function savePlayerId(roomCode: string, playerId: string): void {
  let map: Record<string, string> = {};
  try {
    map = JSON.parse(localStorage.getItem(IDS_KEY) ?? '{}');
  } catch {
    /* ignore */
  }
  map[roomCode] = playerId;
  localStorage.setItem(IDS_KEY, JSON.stringify(map));
}

export function emitAck<Req, Res>(event: string, payload: Req): Promise<Res> {
  return new Promise((resolve) => {
    (socket.emit as unknown as (e: string, p: Req, cb: (r: Res) => void) => void)(event, payload, resolve);
  });
}
