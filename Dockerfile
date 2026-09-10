# ---------- 构建阶段：安装全部依赖并构建前端 ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY shared/ shared/
COPY server/ server/
COPY web/ web/
RUN npm run build -w web \
  && npm prune --omit=dev

# ---------- 运行镜像：仅生产依赖 + 服务器源码 + 前端产物 ----------
FROM node:20-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY shared/package.json shared/
COPY shared/src shared/src
COPY server/package.json server/
COPY server/src server/src
COPY --from=build /app/web/dist ./web/dist
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health > /dev/null || exit 1
# shared 以 TS 源码形式被引用，因此运行时直接用 tsx 执行服务器
CMD ["./node_modules/.bin/tsx", "server/src/index.ts"]
