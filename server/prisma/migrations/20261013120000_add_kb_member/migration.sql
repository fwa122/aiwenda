-- 知识库成员表（协作授权：owner 不入表，editor 可写 / viewer 只读，知识库或用户删除时级联清理）
-- CreateTable
CREATE TABLE "kb_members" (
    "id" TEXT NOT NULL,
    "kb_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" VARCHAR(16) NOT NULL DEFAULT 'viewer',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kb_members_kb_id_user_id_key" ON "kb_members"("kb_id", "user_id");

-- CreateIndex
CREATE INDEX "kb_members_user_id_idx" ON "kb_members"("user_id");

-- AddForeignKey
ALTER TABLE "kb_members" ADD CONSTRAINT "kb_members_kb_id_fkey" FOREIGN KEY ("kb_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_members" ADD CONSTRAINT "kb_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
