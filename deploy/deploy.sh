#!/usr/bin/env bash
# 服务器端部署脚本：拉取最新 main 分支并重建容器。
# CI（GitHub Actions）通过 SSH 执行此脚本；也可在服务器上手动运行。
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/texas-holdem}"
cd "$APP_DIR"

echo "==> 拉取最新代码"
git fetch origin main
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
