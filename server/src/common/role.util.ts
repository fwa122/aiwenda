/** 角色 → 角色名映射（契约 2.7 User.roleName；四级体系 v0.9.61）
 *  权威源是 roles 表（annotateRoleName 优先取库），此处为角色行缺失时的降级映射 */
export const ROLE_NAME: Record<string, string> = {
  owner: '站长',
  super_admin: '超级管理员',
  admin: '管理员',
  viewer: '普通用户',
};

/** 给用户对象附加 roleName（不修改原对象） */
export function withRoleName<T extends { role?: string }>(user: T): T & { roleName: string } {
  return { ...user, roleName: ROLE_NAME[user.role] || user.role || '未知' };
}
