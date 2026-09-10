#!/usr/bin/env bash
# Let's Encrypt 证书首次签发引导脚本（幂等：证书已存在则直接跳过）。
#
# 死锁问题：Nginx 443 server 引用的证书文件不存在时 Nginx 无法启动，
# 而 certbot webroot 签发出证书又需要 Nginx 先跑起来。
# 解法（certbot 官方推荐）：先造一张自签 dummy 证书让 Nginx 启动，
# 签发真实证书后删掉 dummy 并 reload。
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/texas-holdem}"
cd "$APP_DIR"

DOMAIN="${DOMAIN:-chammmsblog.site}"
EMAIL="${CERTBOT_EMAIL:-admin@${DOMAIN}}"
COMPOSE="docker compose"

echo "==> 拉取 nginx / certbot 镜像"
$COMPOSE pull --quiet nginx certbot || true

echo "==> 检查 ${DOMAIN} 证书是否已存在"
if $COMPOSE run --rm --entrypoint sh certbot -c \
    "test -f /etc/letsencrypt/live/${DOMAIN}/fullchain.pem" 2>/dev/null; then
  echo "==> 证书已存在，跳过签发"
  exit 0
fi

echo "==> 创建 dummy 自签证书以启动 Nginx"
$COMPOSE run --rm --entrypoint sh certbot -c \
  "mkdir -p /etc/letsencrypt/live/${DOMAIN} && \
   openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
     -keyout /etc/letsencrypt/live/${DOMAIN}/privkey.pem \
     -out /etc/letsencrypt/live/${DOMAIN}/fullchain.pem \
     -subj '/CN=localhost'"

echo "==> 启动 app 与 nginx"
$COMPOSE up -d app nginx

echo "==> 删除 dummy 证书"
$COMPOSE run --rm --entrypoint sh certbot -c \
  "rm -rf /etc/letsencrypt/live/${DOMAIN} \
          /etc/letsencrypt/archive/${DOMAIN} \
          /etc/letsencrypt/renewal/${DOMAIN}.conf"

echo "==> 申请 Let's Encrypt 真实证书（webroot 方式）"
$COMPOSE run --rm --entrypoint certbot certbot certonly \
  --webroot -w /var/www/certbot \
  -d "${DOMAIN}" \
  --email "${EMAIL}" \
  --agree-tos --no-eff-email --non-interactive

echo "==> 重载 Nginx 加载真实证书"
$COMPOSE exec nginx nginx -s reload

echo "==> 证书签发完成 ✅"
