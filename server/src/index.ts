import './env.js';
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

/** 应用统一挂载在 /texas-holdem 前缀下（本地与生产行为一致；Nginx 仅透传不剥离） */
export const BASE_PATH = '/texas-holdem';

export function createApp() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: true }, // 开发期 Vite 代理；生产同源部署
    path: `${BASE_PATH}/socket.io`,
  });
  const manager = new RoomManager();
  attachGateway(io, manager);

  // 健康检查：带前缀与不带前缀都可用（不带前缀供 Docker HEALTHCHECK / deploy.sh 使用）
  const health = (_req: express.Request, res: express.Response) => {
    res.json({ ok: true, rooms: (manager as unknown as { rooms?: Map<string, unknown> }).rooms?.size ?? 0 });
  };
  app.get('/api/health', health);
  app.get(`${BASE_PATH}/api/health`, health);

  // 生产模式：单进程托管前端构建产物（web/dist），挂载在前缀下
  const webDist = path.resolve(__dirname, '../../web/dist');
  if (existsSync(webDist)) {
    app.use(BASE_PATH, express.static(webDist));
    app.get(`${BASE_PATH}/*`, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
    app.get('/', (_req, res) => res.redirect(`${BASE_PATH}/`));
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
