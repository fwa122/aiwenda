-- 令牌版本（P2 安全专项）：改密/封禁时自增，JWT 携带 ver 校验，
-- 实现改密/封禁后立即吊销该用户全部已签发令牌。存量用户默认 0，平滑兼容。
ALTER TABLE "users" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;
