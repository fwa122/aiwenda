-- DropIndex
DROP INDEX "chunks_embedding_hnsw_idx";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "monthly_token_used" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "token_month" VARCHAR(7);
