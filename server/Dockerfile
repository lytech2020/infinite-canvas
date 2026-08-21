# 云端版后台服务镜像。
FROM node:20-bookworm-slim AS build

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/prisma ./prisma
COPY server/src ./src
RUN npx prisma generate && npm run build

FROM node:20-bookworm-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY server/package.json ./
COPY server/package-lock.json ./

EXPOSE 8787
# 迁移失败时停止启动；幂等 seed 失败只告警，避免可选初始化配置使服务陷入重启循环。
CMD ["sh", "-c", "npx prisma migrate deploy && (node dist/prisma/seed.js || echo '警告：初始化 seed 失败，后台继续启动，请检查配置和日志' >&2) && node dist/src/index.js"]
