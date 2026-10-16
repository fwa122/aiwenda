import { describe, expect, it, vi } from 'vitest';
import { getRoleMap, hasAllScope } from './rbac';

describe('hasAllScope 数据范围判定', () => {
  it('dataScope=ALL 即超管，与 role 字符串无关', () => {
    expect(hasAllScope({ role: 'admin', dataScope: 'ALL' })).toBe(true);
    expect(hasAllScope({ role: 'boss', dataScope: 'ALL' })).toBe(true);
    expect(hasAllScope({ role: 'admin', dataScope: 'SELF' })).toBe(false);
  });

  it('dataScope 缺失（异常/降级路径）按最小权限处理', () => {
    expect(hasAllScope({ role: 'admin' })).toBe(false);
    expect(hasAllScope(null)).toBe(false);
    expect(hasAllScope(undefined)).toBe(false);
  });

  it('DEPT/SELF 均非超管（本期预留值）', () => {
    expect(hasAllScope({ role: 'dept_admin', dataScope: 'DEPT' })).toBe(false);
    expect(hasAllScope({ role: 'viewer', dataScope: 'SELF' })).toBe(false);
  });
});

describe('getRoleMap 角色 code → 记录映射', () => {
  it('按 code 建立映射', async () => {
    const prisma = {
      role: {
        findMany: vi.fn().mockResolvedValue([
          { code: 'admin', name: '超级管理员', dataScope: 'ALL' },
          { code: 'viewer', name: '只读访客', dataScope: 'SELF' },
        ]),
      },
    };
    const map = await getRoleMap(prisma as any);
    expect(map.size).toBe(2);
    expect(map.get('admin')?.dataScope).toBe('ALL');
    expect(map.get('viewer')?.name).toBe('只读访客');
  });
});
