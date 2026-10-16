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
