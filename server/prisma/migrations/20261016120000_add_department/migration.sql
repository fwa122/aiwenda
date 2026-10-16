-- 组织架构：部门树（物化路径以部门 id 拼接）+ 用户部门归属（一人多部门，至多一个主部门）
-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "parent_id" TEXT,
    "name" VARCHAR(64) NOT NULL,
    "path" VARCHAR(256) NOT NULL,
    "leader_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_departments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "dept_id" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_departments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "departments_parent_id_idx" ON "departments"("parent_id");

-- CreateIndex
CREATE INDEX "departments_path_idx" ON "departments"("path");

-- CreateIndex
CREATE UNIQUE INDEX "user_departments_user_id_dept_id_key" ON "user_departments"("user_id", "dept_id");

-- CreateIndex
CREATE INDEX "user_departments_dept_id_idx" ON "user_departments"("dept_id");

-- AddForeignKey（部门自关联：有子部门时禁止删除父部门，由服务层给出友好提示）
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey（负责人：用户删除时自动置空，不阻塞账号删除流程）
ALTER TABLE "departments" ADD CONSTRAINT "departments_leader_id_fkey" FOREIGN KEY ("leader_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey（归属关系随用户/部门删除级联清理）
ALTER TABLE "user_departments" ADD CONSTRAINT "user_departments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_departments" ADD CONSTRAINT "user_departments_dept_id_fkey" FOREIGN KEY ("dept_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
