import './env.js';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@th/shared';
import { config } from './config.js';
import { RoomManager } from './rooms/RoomManager.js';
import { attachGateway } from './socket/gateway.js';
import { initHistoryRecorder, cleanupHistory } from './history/recorder.js';

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
  // 对局记录持久化（JSONL 落盘；目录不可写时仅告警，不阻断服务启动）
  try {
    initHistoryRecorder(config.historyDir);
  } catch (e) {
    console.warn('[history] 初始化落盘目录失败，对局记录将被停用', e);
  }

  // 后台定期清理过期对局记录（超过保留天数即删除；清理失败仅告警，不影响服务）
  const runHistoryCleanup = () => {
    try {
      const removed = cleanupHistory(config.historyRetentionDays * 24 * 60 * 60 * 1000);
      if (removed > 0) {
        console.log(`[history] 已清除 ${removed} 个超过 ${config.historyRetentionDays} 天的对局记录文件`);
      }
    } catch (e) {
      console.warn('[history] 清理任务异常（忽略）', e);
    }
  };
  runHistoryCleanup();
  setInterval(runHistoryCleanup, 12 * 60 * 60 * 1000).unref();

  // 健康检查：带前缀与不带前缀都可用（不带前缀供 Docker HEALTHCHECK / deploy.sh 使用）
  const health = (_req: express.Request, res: express.Response) => {
    res.json({ ok: true, rooms: (manager as unknown as { rooms?: Map<string, unknown> }).rooms?.size ?? 0 });
  };
  app.get('/api/health', health);
  app.get(`${BASE_PATH}/api/health`, health);

  // 局域网访问地址：本机以 localhost 访问时，前端邀请二维码据此替换为可被手机访问的 IP
  app.get(`${BASE_PATH}/api/lan`, (_req, res) => {
    res.json({ urls: lanAddresses().map((a) => `http://${a}:${config.port}${BASE_PATH}/`) });
  });

  // 生产模式：单进程托管前端构建产物（web/dist），挂载在前缀下
  const webDist = path.resolve(__dirname, '../../web/dist');
  if (existsSync(webDist)) {
    app.use(BASE_PATH, express.static(webDist));
    app.get(`${BASE_PATH}/*`, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
    app.get('/', (_req, res) => res.redirect(`${BASE_PATH}/`));
  }

  return { app, httpServer, io, manager };
}

/** 收集本机局域网 IPv4 地址（供手机同网扫码访问；排除回环、虚拟网卡与 169.254 链路本地地址） */
function lanAddresses(): string[] {
  const addrs: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const it of list ?? []) {
      if (it.family === 'IPv4' && !it.internal && !it.address.startsWith('169.254.')) {
        addrs.push(it.address);
      }
    }
  }
  return addrs;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const { httpServer } = createApp();
  httpServer.listen(config.port, config.host, async () => {
    console.log(`♠ 德州扑克服务器已启动: http://localhost:${config.port}${BASE_PATH}/`);
    // 打印局域网访问地址 + 二维码，手机同网扫码即可进入
    const addrs = lanAddresses();
    if (addrs.length > 0) {
      const url = `http://${addrs[0]}:${config.port}${BASE_PATH}/`;
      console.log('\n📱 手机扫码进入（手机与电脑连同一 Wi-Fi）：');
      for (const a of addrs) console.log(`   http://${a}:${config.port}${BASE_PATH}/`);
      try {
        console.log(await QRCode.toString(url, { type: 'terminal' }));
      } catch {
        // 二维码打印失败不影响启动
      }
    }
  });
}
