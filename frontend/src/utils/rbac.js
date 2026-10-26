/**
 * 四级角色体系前端工具（v0.9.61，与后端 common/rbac.ts 口径一致）：
 * 站长(owner) > 超级管理员(super_admin) > 管理员(admin) > 普通用户(viewer)
 * - owner / super_admin：全站文档上传/删除/建库 + 平台运维（模型/密钥/部门/日志/统计）
 * - admin：不参与知识库文档，专职用户管理（管理普通用户）
 * - viewer：仅问答
 */
export const ROLE_RANK = { owner: 4, super_admin: 3, admin: 2, viewer: 1 }

export const ROLE_LABELS = {
  owner: '站长',
  super_admin: '超级管理员',
  admin: '管理员',
  viewer: '普通用户'
}

export function rankOf(role) {
  return ROLE_RANK[role] || 0
}

/** 角色徽章色（el-tag type） */
export const ROLE_TAG = { owner: 'danger', super_admin: 'warning', admin: 'primary', viewer: 'info' }

export function roleTagType(role) {
  return ROLE_TAG[role] || 'info'
}

/** 授予矩阵（不可越级）：站长全权（不含 owner）；超管授管理员/普通用户；管理员仅建普通用户 */
export function canGrantRole(actorRole, targetRole) {
  if (targetRole === 'owner') return false
  if (actorRole === 'owner') return true
  if (actorRole === 'super_admin') return targetRole === 'admin' || targetRole === 'viewer'
  if (actorRole === 'admin') return targetRole === 'viewer'
  return false
}

/** 用户管理范围：目标 rank 严格低于操作者（owner 互不可管理） */
export function canManageUser(actorRole, targetRole) {
  if (targetRole === 'owner') return false
  return rankOf(actorRole) > rankOf(targetRole)
}
