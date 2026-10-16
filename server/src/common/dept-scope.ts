/**
 * 数据范围（部门可见域）计算：kb / chat / search 共用。
 * 语义（对齐「orgId 部门（含子树）成员自动只读可见」）：
 * KB 归属部门 X → X 自身与 X 的全部后代部门的成员可读。
 * 反推用户视角：用户可见的 DEPT 库 = orgId 落在「本人归属部门的祖先链（含自身）」上的库。
 * 后续接入缓存时只需改本文件，调用方无感。
 */
import { PrismaService } from '../prisma/prisma.service';

/** 段边界严格的前缀命中：path 是 ancestorPath 自身或其后代（避开 /dept_a 误配 /dept_ab） */
function inSubtree(path: string, ancestorPath: string): boolean {
  return path === ancestorPath || path.startsWith(`${ancestorPath}/`);
}

/**
 * 用户可见 DEPT 库的 orgId 集合：本人全部归属部门的祖先链（含自身）。
 * 例：用户在总部/门店/生鲜组 → 总部、门店、生鲜组三级建的 DEPT 库均可见。
 */
export async function visibleDeptIds(
  prisma: PrismaService,
  userId: string
): Promise<string[]> {
  const rows = await prisma.userDepartment.findMany({
    where: { userId },
    select: { department: { select: { path: true } } },
  });
  const myPaths = rows.map((r) => r.department?.path).filter((p): p is string => !!p);
  if (!myPaths.length) return [];
  // 部门量级千级以内，一次全量拉取内存过滤即可（与 department.tree() 同一口径）
  const all = await prisma.department.findMany({ select: { id: true, path: true } });
  return all
    .filter((d) => myPaths.some((p) => inSubtree(p, d.path)))
    .map((d) => d.id);
}

/** 单库判定：kb.orgId 是否落在用户可见范围内（orgId 为空不适用 → false） */
export async function isKbDeptVisible(
  prisma: PrismaService,
  userId: string,
  orgId: string | null | undefined
): Promise<boolean> {
  if (!orgId) return false;
  const [dept, rows] = await Promise.all([
    prisma.department.findUnique({ where: { id: orgId }, select: { path: true } }),
    prisma.userDepartment.findMany({
      where: { userId },
      select: { department: { select: { path: true } } },
    }),
  ]);
  if (!dept?.path) return false;
  // KB 对归属部门 X 及其子树成员开放：用户任一归属部门是 X 或 X 的后代即可
  return rows.some((r) => {
    const p = r.department?.path;
    return !!p && inSubtree(p, dept.path);
  });
}
