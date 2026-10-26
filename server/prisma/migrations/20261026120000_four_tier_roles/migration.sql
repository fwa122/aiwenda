-- 四级角色体系（v0.9.61）：站长(owner) > 超级管理员(super_admin) > 管理员(admin) > 普通用户(viewer)
-- 权限语义：
-- - owner / super_admin：dataScope=ALL（全站文档上传/删除/建库，hasAllScope 自动生效）
-- - admin（管理员）：dataScope=SELF（不参与知识库文档模块，专职用户管理——协助管理普通用户）
-- - viewer：仅问答（不变）
-- 授权链（不可越级）：super_admin 仅 owner 可授；admin 可由 owner/super_admin 授；
-- 管理员只能管理 viewer（角色授予由 owner/super_admin 执行）

-- 1) 新增内置角色（幂等）
INSERT INTO "roles" ("id", "code", "name", "data_scope", "builtin", "remark", "sort", "updated_at") VALUES
    ('role_sys_owner', 'owner', '站长', 'ALL', true, '内置角色：系统所有者，最高权限', 0, CURRENT_TIMESTAMP),
    ('role_sys_super_admin', 'super_admin', '超级管理员', 'ALL', true, '内置角色：全站文档管理与运维', 1, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- 2) 旧 admin 角色（原 ALL 超管）降级为「管理员」：SELF，不再参与文档写操作
UPDATE "roles" SET "name" = '管理员', "data_scope" = 'SELF',
  "remark" = '内置角色：用户管理（协助管理普通用户），不参与知识库文档', "sort" = 2, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'admin';

-- 3) 存量用户迁移（顺序敏感：先把原 admin 用户升为 owner，再把 editor 用户归为管理员）
UPDATE "users" SET "role" = 'owner' WHERE "role" = 'admin';
UPDATE "users" SET "role" = 'admin' WHERE "role" = 'editor';

-- 4) 旧 editor 角色行退役改名（无用户引用后仅留档；保留行避免历史日志 roleName 断链）
UPDATE "roles" SET "name" = '知识库编辑(退役)', "remark" = 'v0.9.61 起退役：编辑权并入四级体系', "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'editor';
