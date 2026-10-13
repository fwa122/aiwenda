-- 检索评测用例表（golden QA，按知识库隔离，知识库删除时级联清理）
-- CreateTable
CREATE TABLE "eval_cases" (
    "id" TEXT NOT NULL,
    "kb_id" TEXT NOT NULL,
    "question" VARCHAR(512) NOT NULL,
    "doc_name_contains" VARCHAR(128) NOT NULL,
    "keywords" TEXT[] NOT NULL,
    "note" TEXT,
    "source" VARCHAR(16) NOT NULL DEFAULT 'manual',
    "is_hard" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eval_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "eval_cases_kb_id_enabled_idx" ON "eval_cases"("kb_id", "enabled");

-- AddForeignKey
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_kb_id_fkey" FOREIGN KEY ("kb_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
