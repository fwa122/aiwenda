# Node BFF 多阶段构建：build（tsc + prisma generate）→ 运行（仅生产依赖）
# 基础镜像用 slim 而非 alpine：规避 Prisma 在 alpine 的 openssl 兼容问题

FROM node:24-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
# --legacy-peer-deps：@nestjs/schematics@12 声明 TS>=6 peer，项目用 TS 5.x（仅 CLI 用途，不影响构建）
RUN npm ci --legacy-peer-deps

COPY . .
RUN npx prisma generate \
    && npm run build \
    # seed.ts 单独编译为 JS（运行层无 ts-node），供容器首启播种 admin
    && npx tsc prisma/seed.ts --outDir prisma/dist-seed --module commonjs --target es2020 --esModuleInterop --skipLibCheck

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    TZ=Asia/Shanghai

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# Prisma 生成产物（query engine + client 代码）
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=build /app/prisma/dist-seed/seed.js ./prisma/seed.js
COPY --from=build /app/prisma/migrations ./prisma/migrations
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Windows 构建上下文可能带 CRLF，统一去 \r 防止 entrypoint 执行失败
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh && chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
