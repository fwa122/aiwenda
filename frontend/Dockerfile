# 前端多阶段构建：Node 构建 dist → nginx 托管
# 构建期注入 VITE_*（构建时固化），产物进镜像，服务器无需 Node 环境

FROM node:24-slim AS build
WORKDIR /app

# 先拷依赖清单，利用 Docker 层缓存（package.json 不变时跳过 npm ci）
COPY package.json package-lock.json ./
RUN npm ci

# 再拷源码构建（VITE_USE_MOCK=false、VITE_API_BASE=/api 由 .env.production 提供）
COPY . .
RUN npm run build

# 运行阶段：nginx 托管静态资源
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
