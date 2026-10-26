-- 开放策略（v0.9.46）：注册即全员可读——可见性默认值 PRIVATE → PUBLIC，
-- 存量 PRIVATE 库统一刷新为 PUBLIC（上传/管理特权仍由 owner/admin 亲自授予，与可见性解耦）
-- ALTER TABLE
ALTER TABLE "knowledge_bases" ALTER COLUMN "visibility" SET DEFAULT 'PUBLIC';

-- 存量数据刷新：PRIVATE → PUBLIC（全员只读）
UPDATE "knowledge_bases" SET "visibility" = 'PUBLIC' WHERE "visibility" = 'PRIVATE';
