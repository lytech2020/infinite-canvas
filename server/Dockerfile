# 云端版后台服务镜像。
FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY server/package.json ./
RUN npm install
COPY server/tsconfig.json ./
COPY server/prisma ./prisma
COPY server/src ./src
RUN npx prisma generate && npm run build

FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY server/package.json ./

EXPOSE 8787
# 启动前执行数据库迁移，保证表结构与代码一致。
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/index.js"]
