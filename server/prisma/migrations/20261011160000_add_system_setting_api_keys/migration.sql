-- 系统设置表新增 api_keys 列：前端设置页配置的 LLM API Key（明文 JSONB，仅 admin 可写，接口读取一律脱敏）
ALTER TABLE "system_settings" ADD COLUMN "api_keys" JSONB;
