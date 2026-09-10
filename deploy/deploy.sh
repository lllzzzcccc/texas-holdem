#!/usr/bin/env bash
# 服务器端部署脚本：拉取最新 main 分支并重建容器。
# CI（GitHub Actions）通过 SSH 执行此脚本；也可在服务器上手动运行。
set -euo pipefail

# 服务器 CentOS 7 自带 git 1.8，不支持 core.sshCommand / GIT_SSH_COMMAND，
# 用 GIT_SSH 包装脚本指定仓库部署密钥（Deploy key）
export GIT_SSH="${GIT_SSH:-/root/.ssh/git-ssh-wrapper.sh}"

APP_DIR="${APP_DIR:-/opt/texas-holdem}"
cd "$APP_DIR"

echo "==> 拉取最新代码"
# 注意：不要写成 git fetch origin main —— git 1.8 下带 ref 只更新 FETCH_HEAD，
# 不会更新 refs/remotes/origin/main，会导致 reset 到旧提交
git fetch origin
git reset --hard origin/main

echo "==> 重建并重启容器"
docker compose up -d --build

echo "==> 清理悬空镜像"
docker image prune -f > /dev/null

echo "==> 等待健康检查"
for i in $(seq 1 20); do
  if curl -sf http://127.0.0.1:3000/api/health > /dev/null 2>&1 \
    || curl -sf "http://127.0.0.1:${HTTP_PORT:-80}/api/health" > /dev/null 2>&1; then
    echo "==> 部署完成 ✅"
    docker ps --filter name=texas-holdem --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
    exit 0
  fi
  sleep 2
done

echo "==> 健康检查失败，查看最近日志：" >&2
docker logs --tail 50 texas-holdem >&2 || true
exit 1
