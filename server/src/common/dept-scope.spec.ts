import { describe, expect, it, vi } from 'vitest';
import { isKbDeptVisible, visibleDeptIds } from './dept-scope';

const makePrisma = () => ({
  userDepartment: { findMany: vi.fn() },
  department: { findMany: vi.fn(), findUnique: vi.fn() },
});

describe('visibleDeptIds（DEPT 库 orgId 可见集合 = 归属部门的祖先链）', () => {
  it('无部门归属 → 空集，且不查部门表', async () => {
    const prisma = makePrisma();
    prisma.userDepartment.findMany.mockResolvedValue([]);
    const ids = await visibleDeptIds(prisma as any, 'u_1');
    expect(ids).toEqual([]);
    expect(prisma.department.findMany).not.toHaveBeenCalled();
  });

  it('用户在子部门 → 祖先链上的部门建的 DEPT 库均可见；兄弟/旁支不混入', async () => {
    const prisma = makePrisma();
    prisma.userDepartment.findMany.mockResolvedValue([
      { department: { path: '/dept_a/dept_b' } },
    ]);
    prisma.department.findMany.mockResolvedValue([
      { id: 'dept_a', path: '/dept_a' },
      { id: 'dept_b', path: '/dept_a/dept_b' },
      { id: 'dept_c', path: '/dept_a/dept_c' }, // 同父兄弟
      { id: 'dept_ab', path: '/dept_ab' }, // 与 /dept_a 共前缀的旁支
      { id: 'dept_x', path: '/dept_x' },
    ]);
    const ids = await visibleDeptIds(prisma as any, 'u_1');
    expect(ids.sort()).toEqual(['dept_a', 'dept_b']);
  });

  it('根级部门成员：仅本部门（无祖先）；下级部门建的库不可见', async () => {
    const prisma = makePrisma();
    prisma.userDepartment.findMany.mockResolvedValue([
      { department: { path: '/dept_a' } },
    ]);
    prisma.department.findMany.mockResolvedValue([
      { id: 'dept_a', path: '/dept_a' },
      { id: 'dept_b', path: '/dept_a/dept_b' },
    ]);
    const ids = await visibleDeptIds(prisma as any, 'u_1');
    expect(ids).toEqual(['dept_a']);
  });

  it('多部门兼岗：祖先链并集', async () => {
    const prisma = makePrisma();
    prisma.userDepartment.findMany.mockResolvedValue([
      { department: { path: '/dept_a/dept_b' } },
      { department: { path: '/dept_x' } },
    ]);
    prisma.department.findMany.mockResolvedValue([
      { id: 'dept_a', path: '/dept_a' },
      { id: 'dept_b', path: '/dept_a/dept_b' },
      { id: 'dept_x', path: '/dept_x' },
    ]);
    const ids = await visibleDeptIds(prisma as any, 'u_1');
    expect(ids.sort()).toEqual(['dept_a', 'dept_b', 'dept_x']);
  });
});

describe('isKbDeptVisible（KB 对归属部门及其子树成员开放）', () => {
  it('orgId 为空 → false，不触发查询', async () => {
    const prisma = makePrisma();
    expect(await isKbDeptVisible(prisma as any, 'u_1', null)).toBe(false);
    expect(prisma.department.findUnique).not.toHaveBeenCalled();
  });

  it('用户在本部门 / 本部门的下级部门 → true（子树成员可见）', async () => {
    const prisma = makePrisma();
    prisma.department.findUnique.mockResolvedValue({ path: '/dept_a' });
    prisma.userDepartment.findMany.mockResolvedValue([{ department: { path: '/dept_a' } }]);
    expect(await isKbDeptVisible(prisma as any, 'u_1', 'dept_a')).toBe(true);

    // uc 场景：用户在 A 的子组，能看到 A 的 DEPT 库
    prisma.userDepartment.findMany.mockResolvedValue([
      { department: { path: '/dept_a/dept_b' } },
    ]);
    expect(await isKbDeptVisible(prisma as any, 'u_1', 'dept_a')).toBe(true);
  });

  it('用户在上级部门：子部门库不自动可见；无关部门 / 部门已删除 → false', async () => {
    const prisma = makePrisma();
    prisma.department.findUnique.mockResolvedValue({ path: '/dept_a/dept_b' });
    prisma.userDepartment.findMany.mockResolvedValue([{ department: { path: '/dept_a' } }]);
    expect(await isKbDeptVisible(prisma as any, 'u_1', 'dept_b')).toBe(false);

    prisma.userDepartment.findMany.mockResolvedValue([{ department: { path: '/dept_x' } }]);
    expect(await isKbDeptVisible(prisma as any, 'u_1', 'dept_b')).toBe(false);

    prisma.department.findUnique.mockResolvedValue(null);
    expect(await isKbDeptVisible(prisma as any, 'u_1', 'dept_gone')).toBe(false);
  });
});
