-- v0.9.40 语义缓存：system_settings 增加 cache 分区
-- 既有行回填默认值（与 DEFAULT_SETTINGS.cache 一致）
ALTER TABLE "system_settings" ADD COLUMN "cache" JSONB NOT NULL
  DEFAULT '{"enableSemanticCache": true, "cacheThreshold": 0.12, "cacheTtlDays": 7}'::jsonb;
