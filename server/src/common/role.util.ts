/** 角色 → 角色名映射（契约 2.7 User.roleName） */
export const ROLE_NAME: Record<string, string> = {
  admin: '超级管理员',
  editor: '知识库编辑',
  viewer: '只读访客',
};

/** 给用户对象附加 roleName（不修改原对象） */
export function withRoleName<T extends { role?: string }>(user: T): T & { roleName: string } {
  return { ...user, roleName: ROLE_NAME[user.role] || user.role || '未知' };
}
