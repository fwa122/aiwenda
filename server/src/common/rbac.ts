/**
 * 角色与数据范围（dataScope）判定工具：guard / 服务层共用。
 * 语义：Role.dataScope = ALL 即「超管」，拥有全部数据与管理权限；
 * DEPT（本部门及子树）/ SELF（仅本人）落库预留，本期无运行时消费点。
 * 鉴权链路：jwt.strategy 每请求实时查 roles 表取 dataScope 注入 req.user
 * （角色不存在按 SELF 最小权限兜底），服务层一律用 hasAllScope 判断，
 * 不再硬编码 role === 'admin'。
 */
import { PrismaService } from '../prisma/prisma.service';

/** 判定所需字段（jwt.strategy.validate 返回的 req.user 形状） */
export interface ScopedUser {
  role: string;
  dataScope?: string; // ALL | DEPT | SELF
}

/** 是否超管（ALL 数据范围）：替代原先散落的 user.role === 'admin' 硬编码 */
export function hasAllScope(user: ScopedUser | null | undefined): boolean {
  return user?.dataScope === 'ALL';
}

/** 角色 code → 角色记录（角色个位数行，全量拉取；接缓存时只需改本文件） */
export async function getRoleMap(prisma: PrismaService) {
  const roles = await prisma.role.findMany();
  return new Map(roles.map((r) => [r.code, r]));
}

/**
 * 四级角色体系（v0.9.61）：站长 > 超级管理员 > 管理员 > 普通用户。
 * - owner / super_admin：dataScope=ALL（全站文档/建库/运维，hasAllScope 自动生效）
 * - admin：SELF（不参与知识库文档，专职用户管理——管理普通用户）
 * - viewer：仅问答
 */
export const ROLE_RANK: Record<string, number> = {
  owner: 4,
  super_admin: 3,
  admin: 2,
  viewer: 1,
};

/** 角色中文显示名（前端徽章/下拉统一；roles 表 name 为数据库侧权威源） */
export const ROLE_LABELS: Record<string, string> = {
  owner: '站长',
  super_admin: '超级管理员',
  admin: '管理员',
  viewer: '普通用户',
};

/** 平台运维级角色（系统设置/密钥/部门/日志/统计）：站长+超级管理员 */
export const PLATFORM_ROLES = ['owner', 'super_admin'] as const;

/** 用户管理可见角色（用户列表/建号）：管理员及以上 */
export const USER_MGMT_ROLES = ['owner', 'super_admin', 'admin'] as const;

export function rankOf(role: string | null | undefined): number {
  return ROLE_RANK[role ?? ''] ?? 0;
}

/**
 * 角色授予矩阵（不可越级）：
 * - owner：可授 super_admin/admin/viewer（不可授 owner——站长唯一，防自锁）
 * - super_admin：可授 admin/viewer（super_admin 仅 owner 可授）
 * - admin：仅可建/授 viewer（管理普通用户的日常职责：建号）
 * - viewer：不可授任何角色
 */
export function canGrantRole(actorRole: string, targetRole: string): boolean {
  if (targetRole === 'owner') return false;
  if (actorRole === 'owner') return true;
  if (actorRole === 'super_admin') return targetRole === 'admin' || targetRole === 'viewer';
  if (actorRole === 'admin') return targetRole === 'viewer';
  return false;
}

/**
 * 用户管理范围（编辑/封禁/删除/建号归属校验）：目标 rank 严格低于操作者。
 * owner 不能操作 owner（防站长互删自锁）；同级不可越权管理。
 */
export function canManageUser(actorRole: string, targetRole: string): boolean {
  if (targetRole === 'owner') return false;
  return rankOf(actorRole) > rankOf(targetRole);
}
