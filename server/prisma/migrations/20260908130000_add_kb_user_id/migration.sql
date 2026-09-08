-- 知识库归属用户（private 可见性按属主隔离）；本机此前以 db push 同步、缺失迁移文件
-- AlterTable
ALTER TABLE "knowledge_bases" ADD COLUMN     "user_id" TEXT;

-- CreateIndex
CREATE INDEX "knowledge_bases_user_id_idx" ON "knowledge_bases"("user_id");

-- AddForeignKey
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
