import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@th/shared';
import { config } from './config.js';
import { RoomManager } from './rooms/RoomManager.js';
import { attachGateway } from './socket/gateway.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: true }, // 开发期 Vite 代理 /socket.io；生产同源部署
  });
  const manager = new RoomManager();
  attachGateway(io, manager);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, rooms: (manager as unknown as { rooms?: Map<string, unknown> }).rooms?.size ?? 0 });
  });

  // 生产模式：单进程托管前端构建产物（web/dist）
  const webDist = path.resolve(__dirname, '../../web/dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  return { app, httpServer, io, manager };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const { httpServer } = createApp();
  httpServer.listen(config.port, config.host, () => {
    console.log(`♠ 德州扑克服务器已启动: http://${config.host}:${config.port}`);
  });
}
