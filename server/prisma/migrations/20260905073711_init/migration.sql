-- 启用 pgvector 扩展（向量检索依赖，必须在使用 vector 类型之前）
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "nickname" VARCHAR(64),
    "email" VARCHAR(128),
    "phone" VARCHAR(32),
    "role" VARCHAR(16) NOT NULL DEFAULT 'viewer',
    "department" VARCHAR(64),
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "conversation_limit" INTEGER NOT NULL DEFAULT 30,
    "doc_limit" INTEGER NOT NULL DEFAULT 200,
    "storage_limit" BIGINT NOT NULL DEFAULT 1073741824,
    "monthly_token_limit" INTEGER NOT NULL DEFAULT 200000,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_bases" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" TEXT,
    "icon" VARCHAR(32),
    "color" VARCHAR(16),
    "status" VARCHAR(16) NOT NULL DEFAULT 'draft',
    "doc_count" INTEGER NOT NULL DEFAULT 0,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "total_size" BIGINT NOT NULL DEFAULT 0,
    "embedding_model" VARCHAR(64) NOT NULL DEFAULT 'bge-large-zh-v1.5',
    "vector_dim" INTEGER NOT NULL DEFAULT 1024,
    "vector_store" VARCHAR(32) NOT NULL DEFAULT 'pgvector',
    "chunk_size" INTEGER NOT NULL DEFAULT 512,
    "chunk_overlap" INTEGER NOT NULL DEFAULT 64,
    "parser" VARCHAR(16) NOT NULL DEFAULT 'smart',
    "retriever_config" JSONB NOT NULL,
    "llm_config" JSONB NOT NULL,
    "visibility" VARCHAR(16) NOT NULL DEFAULT 'internal',
    "owner" VARCHAR(64),
    "member_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "kb_id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" VARCHAR(16) NOT NULL,
    "size" BIGINT NOT NULL DEFAULT 0,
    "pages" INTEGER NOT NULL DEFAULT 0,
    "storage_key" VARCHAR(255),
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "error_msg" TEXT,
    "version" VARCHAR(32),
    "uploader" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chunks" (
    "id" TEXT NOT NULL,
    "kb_id" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "page" INTEGER NOT NULL DEFAULT 1,
    "char_count" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL,
    "embedding" vector(1024),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" VARCHAR(128) NOT NULL,
    "kb_ids" JSONB NOT NULL,
    "model" VARCHAR(64),
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "token_used" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "content" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'done',
    "meta" JSONB,
    "feedback" VARCHAR(16),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_sources" (
    "id" BIGSERIAL NOT NULL,
    "message_id" TEXT NOT NULL,
    "kb_id" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "chunk_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "page" INTEGER NOT NULL DEFAULT 1,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "message_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "key_hash" VARCHAR(255) NOT NULL,
    "key_preview" VARCHAR(32) NOT NULL,
    "scope" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "quota_per_day" INTEGER NOT NULL DEFAULT 1000,
    "used_today" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "expired_at" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "model" JSONB NOT NULL,
    "retrieval" JSONB NOT NULL,
    "security" JSONB NOT NULL,
    "storage" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_logs" (
    "id" BIGSERIAL NOT NULL,
    "user_id" TEXT,
    "user_name" VARCHAR(64),
    "action" VARCHAR(64) NOT NULL,
    "target" VARCHAR(255),
    "ip" VARCHAR(64),
    "result" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_stats" (
    "id" BIGSERIAL NOT NULL,
    "date" DATE NOT NULL,
    "questions" INTEGER NOT NULL DEFAULT 0,
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "avg_latency" INTEGER NOT NULL DEFAULT 0,
    "tokens" BIGINT NOT NULL DEFAULT 0,
    "active_users" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "knowledge_bases_status_idx" ON "knowledge_bases"("status");

-- CreateIndex
CREATE INDEX "knowledge_bases_updated_at_idx" ON "knowledge_bases"("updated_at");

-- CreateIndex
CREATE INDEX "documents_kb_id_status_idx" ON "documents"("kb_id", "status");

-- CreateIndex
CREATE INDEX "documents_kb_id_updated_at_idx" ON "documents"("kb_id", "updated_at");

-- CreateIndex
CREATE INDEX "chunks_doc_id_idx" ON "chunks"("doc_id");

-- CreateIndex
CREATE INDEX "chunks_kb_id_idx" ON "chunks"("kb_id");

-- CreateIndex
CREATE INDEX "conversations_user_id_pinned_updated_at_idx" ON "conversations"("user_id", "pinned", "updated_at");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "message_sources_message_id_idx" ON "message_sources"("message_id");

-- CreateIndex
CREATE INDEX "api_keys_user_id_idx" ON "api_keys"("user_id");

-- CreateIndex
CREATE INDEX "operation_logs_created_at_idx" ON "operation_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "daily_stats_date_key" ON "daily_stats"("date");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_kb_id_fkey" FOREIGN KEY ("kb_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_kb_id_fkey" FOREIGN KEY ("kb_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_sources" ADD CONSTRAINT "message_sources_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 向量检索 HNSW 索引（cosine 距离），大幅提升语义召回性能
CREATE INDEX IF NOT EXISTS "chunks_embedding_hnsw_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);
