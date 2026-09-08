#!/bin/sh
set -e

echo "[entrypoint] 1/3 prisma migrate deploy ..."
npx prisma migrate deploy

echo "[entrypoint] 2/3 seed admin（幂等，已存在则跳过）..."
node prisma/seed.js || echo "⚠️ seed 跳过（admin 可能已存在，或可手动注册）"

echo "[entrypoint] 3/3 启动 Node BFF ..."
exec node dist/main.js
