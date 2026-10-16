-- Step 2：知识库数据范围过滤 —— 归属部门 org_id + 可见性升级为三态枚举
-- 旧字符串值映射：internal（企业内可见）/ public → PUBLIC；private → PRIVATE
-- 新语义：PRIVATE 仅 owner+成员；DEPT 归属部门（含子树）成员只读；PUBLIC 全员只读

CREATE TYPE "KbVisibility" AS ENUM ('PRIVATE', 'DEPT', 'PUBLIC');

ALTER TABLE "knowledge_bases" ADD COLUMN "org_id" TEXT;

UPDATE "knowledge_bases" SET "visibility" = 'PUBLIC' WHERE "visibility" IN ('internal', 'public');
UPDATE "knowledge_bases" SET "visibility" = 'PRIVATE' WHERE "visibility" = 'private';

-- 默认值随类型一起切换：先摘旧默认（'internal' 无法转型），换型后落新默认
ALTER TABLE "knowledge_bases" ALTER COLUMN "visibility" DROP DEFAULT;
ALTER TABLE "knowledge_bases" ALTER COLUMN "visibility" TYPE "KbVisibility" USING "visibility"::"KbVisibility";
ALTER TABLE "knowledge_bases" ALTER COLUMN "visibility" SET DEFAULT 'PRIVATE';

CREATE INDEX "knowledge_bases_org_id_idx" ON "knowledge_bases"("org_id");
