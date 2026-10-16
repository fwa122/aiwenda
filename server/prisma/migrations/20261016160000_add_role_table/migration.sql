-- 角色表：配置化鉴权（users.role 存角色 code 逻辑外键），dataScope 数据范围替代硬编码角色名判断
-- CreateEnum
CREATE TYPE "DataScope" AS ENUM ('ALL', 'DEPT', 'SELF');

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'SELF',
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "remark" VARCHAR(128),
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- Seed 内置角色（幂等）：admin=ALL 超管，editor/viewer=SELF 仅本人数据
INSERT INTO "roles" ("id", "code", "name", "data_scope", "builtin", "remark", "sort", "updated_at") VALUES
    ('role_sys_admin', 'admin', '超级管理员', 'ALL', true, '内置角色：拥有全部数据与管理权限', 1, CURRENT_TIMESTAMP),
    ('role_sys_editor', 'editor', '知识库编辑', 'SELF', true, '内置角色：可创建并管理自己的知识库', 2, CURRENT_TIMESTAMP),
    ('role_sys_viewer', 'viewer', '只读访客', 'SELF', true, '内置角色：仅浏览授权内容', 3, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
