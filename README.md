# 德州扑克在线版（texas-holdem）

多人在线无限注德州扑克（No-Limit Texas Hold'em）。好友间通过房间号/二维码开局，全程虚拟积分，无真实支付。

## 功能

- 🏛️ **游戏大厅**：主页实时展示所有牌桌（上限 10 桌），点击任意牌桌进入——等待中可入座，游戏中可观战
- ⚙️ **房间设置**：创建房间时可选盲注档位（5/10 ~ 100/200）、最大座位数（2~9 人）、回合行动限时（15~60 秒）、回合数上限
- 🚪 **房间系统**：创建/加入房间，6 位房间号 + 二维码邀请
- 💰 **虚拟积分**：入座前购买积分（纯虚拟，无支付渠道），买入范围 20BB~200BB
- 🪑 **真实牌桌**：经典椭圆桌面、座位环绕（坐哪就是哪，不强制旋转）；响应式适配桌面与手机竖屏（竖屏切换竖椭圆桌）
- 👑 **房主控制**：房主开始/结束游戏；开始后新玩家只能观战
- 🂡 **抽牌定庄**：开局全员抽牌比大小（同点比花色 ♠>♥>♦>♣），最大者成为 Dealer
- 🎰 **完整规则**：盲注、翻前/翻牌/转牌/河牌、最小加注、短 all-in 不重开、边池、摊牌比牌、平分池与奇数筹码、heads-up 特殊盲注序、回合计时（超时自动过牌/弃牌；离线玩家轮到即弃牌；可继续玩家不足 2 人自动结算）
- 📊 **回合结算面板**：每手结束展示全部玩家手牌、弃牌标记、赢家与赢得金额，由房主确认后才开始下一手
- 🎬 **全程动画**：发牌飞出、筹码入池、逐张翻牌、摊牌亮牌、分池飞筹码、庄家按钮，GSAP 串行动画队列，无页面跳变
- 🃏 **下注面板**：预设尺度卡片（最小/½底池/¾底池/底池/All-in）+ 可拖动滑轨
- 🔌 **断线重连**：凭本地令牌重连恢复座位与底牌；房主离开自动转让

## 技术栈

- **前端**：Vue 3 + Vite + TypeScript + Pinia + GSAP + socket.io-client + qrcode
- **后端**：Node.js + Express + Socket.IO + TypeScript（tsx 运行）
- **引擎**：纯 TS 状态机（可注入固定牌堆测试），比牌用 pokersolver
- **结构**：npm workspaces 单仓（`shared` 协议 / `server` 后端 / `web` 前端）

## 本地开发

```bash
npm install
npm run dev        # 同时启动后端(:3000)与前端 Vite(:5173，代理 socket.io)
```

浏览器开两个窗口访问 <http://localhost:5173>（其中一个用无痕窗口模拟第二名玩家）。

## 生产运行（单进程）

```bash
npm install
npm run build      # 构建前端到 web/dist
npm start          # Node 单进程托管前端 + socket.io，默认 :3000
```

访问 <http://localhost:3000>。

## Docker 部署（推荐）

服务器只需安装 Docker 与 Docker Compose，无需 Node.js：

```bash
git clone https://github.com/lllzzzcccc/texas-holdem.git /opt/texas-holdem
cd /opt/texas-holdem
# 配置域名（用于 Nginx server_name、证书签发与二维码链接）
echo 'DOMAIN=poker.example.com
PUBLIC_URL=https://poker.example.com/texas-holdem' > .env
docker compose up -d --build
```

架构为三容器：

- **app**：Node 单进程（前端静态产物 + socket.io），只绑定 `127.0.0.1:3000`
- **nginx**：对外 80/443。80 跳转 HTTPS；`https://域名/texas-holdem/` 反代到 app（剥离前缀，含 WebSocket Upgrade）
- **certbot**：Let's Encrypt 证书，每 12h 自动续期；nginx 每 6h reload 加载新证书

**首次部署证书签发**：`deploy/deploy.sh` 会自动运行 `deploy/init-letsencrypt.sh`（幂等）——先造 dummy 自签证书让 Nginx 启动，再通过 ACME webroot 签发真实证书并 reload。前提是域名 DNS 已指向服务器且 80/443 端口在安全组放行（大陆机房域名需 ICP 备案）。证书注册邮箱默认 `admin@<域名>`，可用 `.env` 里 `CERTBOT_EMAIL` 覆盖。

**纯 IP 部署（无域名）**：把 compose 里 app 的端口映射改回 `80:3000` 并不启动 nginx/certbot 即可，前端 base 前缀可通过 Nginx 或保持默认。

## CI/CD（GitHub Actions）

推送 `main` 分支即自动：类型检查 → 测试 → 构建 → SSH 到服务器拉代码重建容器（`.github/workflows/deploy.yml`）。

需要在仓库 **Settings → Secrets and variables → Actions** 配置 4 个 secrets：

| Secret | 说明 | 示例 |
| --- | --- | --- |
| `SSH_HOST` | 服务器地址 | `8.130.33.67` |
| `SSH_USER` | SSH 用户 | `root` |
| `SSH_PRIVATE_KEY` | CI 部署专用私钥（对应公钥已加入服务器 `~/.ssh/authorized_keys`） | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `SSH_PORT` | SSH 端口（可选，默认 22） | `22` |

## 部署到服务器（裸机 Node，不用 Docker 时）

1. 服务器安装 Node.js 20+，克隆仓库后执行上面的生产运行步骤
2. 配置环境变量（可复制 `.env.example` 为 `.env`，或直接设置系统环境变量）：
   - `PORT` / `HOST`：监听端口与地址
   - `PUBLIC_URL`：对外访问地址（如 `https://poker.example.com`），用于二维码链接
3. 建议用 Nginx/Caddy 反向代理到 `:3000` 并启用 HTTPS，注意放行 WebSocket（`Upgrade` 头）。Nginx 示例：

   ```nginx
   location / {
     proxy_pass http://127.0.0.1:3000;
     proxy_http_version 1.1;
     proxy_set_header Upgrade $http_upgrade;
     proxy_set_header Connection "upgrade";
     proxy_set_header Host $host;
   }
   ```

其他可调环境变量：`TURN_TIMEOUT_MS`（回合计时，默认 30000）、`NEXT_HAND_DELAY_MS`（两手间隔，默认 7000）、`DISCONNECT_GRACE_MS`（断线宽限，默认 60000）、`EMPTY_ROOM_TTL_MS`（空房销毁，默认 600000）。

## 测试

```bash
npm test           # 引擎单测（边池/最小加注/heads-up/摊牌/分池）+ socket 集成冒烟测试
npm run typecheck  # 前后端 TypeScript 检查
```

## 目录结构

```
shared/src/types.ts        # 前后端共用协议（状态、事件、payload 类型）
server/src/engine/         # 游戏引擎：HandEngine 状态机、边池、比牌、位置、抽牌
server/src/rooms/          # Room（房间生命周期、回合计时、断线处理）+ RoomManager
server/src/socket/         # socket.io 网关（脱敏广播、私信底牌/行动）
web/src/views/             # HomeView（创建/加入）、RoomView（大厅+牌桌一体）
web/src/components/table/  # 椭圆桌、座位、扑克牌、筹码、下注面板
web/src/anim/              # GSAP 串行动画队列 + 桌面锚点
server/test/               # vitest 单测与集成测试
```

## 说明

- 所有积分均为虚拟积分，仅用于游戏计分，不涉及任何真实货币与支付渠道
- 房间状态保存在内存中，服务器重启后房间消失
