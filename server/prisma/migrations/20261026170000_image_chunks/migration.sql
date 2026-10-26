-- v0.9.64 方案B：文档图片抽取入库（回答引用直接带原图）
-- document_images：解析期抽取的原图（MinIO 对象 + VLM 生成图说）
-- chunks.image_id：图片切片与原图的关联（image chunk 的 embedding 来自图说文本）
-- 注：全幂等守卫（IF NOT EXISTS / DO block）——迁移曾在生产环境与手工 DDL 并发执行过一次

CREATE TABLE IF NOT EXISTS document_images (
    id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    kb_id TEXT NOT NULL,
    page INTEGER NOT NULL DEFAULT 1,
    storage_key TEXT NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT document_images_doc_id_fkey FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE,
    CONSTRAINT document_images_kb_id_fkey FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS document_images_doc_id_idx ON document_images(doc_id);
CREATE INDEX IF NOT EXISTS document_images_kb_id_idx ON document_images(kb_id);

ALTER TABLE chunks ADD COLUMN IF NOT EXISTS image_id TEXT;
DO $$ BEGIN
  ALTER TABLE chunks ADD CONSTRAINT chunks_image_id_fkey
    FOREIGN KEY (image_id) REFERENCES document_images(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
