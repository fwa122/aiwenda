import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DepartmentService } from './department.service';

const makePrisma = () => {
  const prisma: any = {
    department: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    userDepartment: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      delete: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    user: { findUnique: vi.fn() },
    knowledgeBase: { count: vi.fn().mockResolvedValue(0) },
    $transaction: vi.fn(),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  // 交互事务透传 tx（单测中 tx 即 prisma 自身）；数组事务直接 Promise.all
  prisma.$transaction.mockImplementation(async (arg: any) =>
    Array.isArray(arg) ? Promise.all(arg) : arg(prisma)
  );
  return prisma;
};

const makeService = (prisma: any) => new DepartmentService(prisma);

describe('DepartmentService.tree', () => {
  it('按 parentId 组装嵌套树，成员数映射为 memberCount', async () => {
    const prisma = makePrisma();
    prisma.department.findMany.mockResolvedValue([
      { id: 'dept_a', parentId: null, name: '总部', path: '/dept_a', leaderId: null, _count: { members: 3 } },
      { id: 'dept_b', parentId: 'dept_a', name: '门店', path: '/dept_a/dept_b', leaderId: null, _count: { members: 0 } },
    ]);
    const tree: any = await makeService(prisma).tree();
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('dept_a');
    expect(tree[0].memberCount).toBe(3);
    expect(tree[0].children[0].id).toBe('dept_b');
  });

  it('孤儿节点（父已删）兜底挂到根，不丢数据', async () => {
    const prisma = makePrisma();
    prisma.department.findMany.mockResolvedValue([
      { id: 'dept_x', parentId: 'dept_gone', name: '遗留', path: '/x', leaderId: null, _count: { members: 0 } },
    ]);
    const tree: any = await makeService(prisma).tree();
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('dept_x');
  });
});

describe('DepartmentService.create', () => {
  it('根部门：path 以自身 id 收尾', async () => {
    const prisma = makePrisma();
    prisma.department.create.mockImplementation(({ data }: any) =>
      Promise.resolve(data)
    );
    const res: any = await makeService(prisma).create({ name: ' 总部 ' } as any);
    expect(res.id).toMatch(/^dept_/);
    expect(res.path).toBe(`/${res.id}`);
    expect(prisma.department.create.mock.calls[0][0].data.name).toBe('总部');
  });

  it('子部门：path = 父 path + 自身 id', async () => {
    const prisma = makePrisma();
    prisma.department.findUnique.mockResolvedValue({ id: 'dept_p', path: '/dept_p' });
    prisma.department.create.mockImplementation(({ data }: any) => Promise.resolve(data));
    const res: any = await makeService(prisma).create({ name: '生鲜部', parentId: 'dept_p' } as any);
    expect(res.path).toBe(`/dept_p/${res.id}`);
  });

  it('上级部门不存在 → 404', async () => {
    const prisma = makePrisma();
    prisma.department.findUnique.mockResolvedValue(null);
    await expect(
      makeService(prisma).create({ name: 'X', parentId: 'dept_gone' } as any)
    ).rejects.toThrow(NotFoundException);
  });

  it('负责人用户不存在 → 404', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      makeService(prisma).create({ name: 'X', leaderId: 'u_none' } as any)
    ).rejects.toThrow(NotFoundException);
  });
});

describe('DepartmentService.update', () => {
  it('负责人必须是本部门成员', async () => {
    const prisma = makePrisma();
    prisma.department.findUnique.mockResolvedValue({ id: 'dept_a', leaderId: null });
    prisma.userDepartment.findUnique.mockResolvedValue(null);
    await expect(
      makeService(prisma).update('dept_a', { leaderId: 'u_out' } as any)
    ).rejects.toThrow(BadRequestException);
  });

  it('成员可设为负责人；清空走 disconnect', async () => {
    const prisma = makePrisma();
    prisma.department.findUnique.mockResolvedValue({ id: 'dept_a', leaderId: 'u_1' });
    prisma.userDepartment.findUnique.mockResolvedValue({ id: 'udm_1' });
    prisma.department.update.mockResolvedValue({});
    await makeService(prisma).update('dept_a', { leaderId: 'u_1' } as any);
    expect(prisma.department.update.mock.calls[0][0].data.leader).toEqual({
      connect: { id: 'u_1' },
    });

    await makeService(prisma).update('dept_a', { leaderId: '' } as any);
    expect(prisma.department.update.mock.calls[1][0].data.leader).toEqual({
      disconnect: true,
    });
  });
});

describe('DepartmentService.move', () => {
  it('parentId 缺失 / 移到自己 → 400', async () => {
    const prisma = makePrisma();
    await expect(makeService(prisma).move('dept_a', {} as any)).rejects.toThrow(
      BadRequestException
    );
    prisma.department.findUnique.mockResolvedValue({ id: 'dept_a', path: '/dept_a' });
    await expect(
      makeService(prisma).move('dept_a', { parentId: 'dept_a' })
    ).rejects.toThrow(BadRequestException);
  });

  it('移到自己的子部门（成环）→ 400', async () => {
    const prisma = makePrisma();
    prisma.department.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.id === 'dept_a'
          ? { id: 'dept_a', path: '/dept_a' }
          : { id: 'dept_b', path: '/dept_a/dept_b' }
      )
    );
    await expect(
      makeService(prisma).move('dept_a', { parentId: 'dept_b' })
    ).rejects.toThrow('不能将部门移动到自己的子部门之下');
  });

  it('正常移动：一条 SQL 重写子树路径前缀 + 更新 parentId', async () => {
    const prisma = makePrisma();
    prisma.department.findUnique
      .mockResolvedValueOnce({ id: 'dept_a', path: '/dept_root/dept_a' }) // mustFind
      .mockResolvedValueOnce({ id: 'dept_new', path: '/dept_top' }); // 目标父
    prisma.department.findUnique.mockResolvedValue({ id: 'dept_a', parentId: 'dept_new' });
    const res: any = await makeService(prisma).move('dept_a', { parentId: 'dept_new' });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const params = prisma.$executeRaw.mock.calls[0].slice(1);
    expect(params).toContain('/dept_top/dept_a');
    expect(params).toContain('/dept_root/dept_a');
    expect(prisma.department.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'dept_a' }, data: { parentId: 'dept_new' } })
    );
    expect(res.parentId).toBe('dept_new');
  });

  it('根级原地不动（无父 → 根）不触发路径重写', async () => {
    const prisma = makePrisma();
    prisma.department.findUnique.mockResolvedValue({ id: 'dept_a', path: '/dept_a' });
    await makeService(prisma).move('dept_a', { parentId: null });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.department.update).not.toHaveBeenCalled();
  });
});

describe('DepartmentService.remove', () => {
  it('有子部门 → 400；有成员 → 400', async () => {
    const prisma = makePrisma();
    prisma.department.findUnique.mockResolvedValue({ id: 'dept_a' });
    prisma.department.count.mockResolvedValue(2);
    await expect(makeService(prisma).remove('dept_a')).rejects.toThrow('子部门');

    prisma.department.count.mockResolvedValue(0);
    prisma.userDepartment.count.mockResolvedValue(1);
    await expect(makeService(prisma).remove('dept_a')).rejects.toThrow('成员');
  });

  it('空部门可删除', async () => {
    const prisma = makePrisma();
    prisma.department.findUnique.mockResolvedValue({ id: 'dept_a' });
    expect(await makeService(prisma).remove('dept_a')).toBeNull();
    expect(prisma.department.delete).toHaveBeenCalledWith({ where: { id: 'dept_a' } });
  });

  it('名下有知识库（orgId 指向本部门）→ 400，防 orgId 悬空导致 DEPT 库静默隐身', async () => {
    const prisma = makePrisma();
    prisma.department.findUnique.mockResolvedValue({ id: 'dept_a' });
    prisma.knowledgeBase.count.mockResolvedValue(3);
    await expect(makeService(prisma).remove('dept_a')).rejects.toThrow('3 个知识库');
    expect(prisma.department.delete).not.toHaveBeenCalled();
  });
});

describe('DepartmentService.addMember', () => {
  const dept = { id: 'dept_a', leaderId: null };

  it('用户不存在 / 已停用 / 重复加入 → 拒绝', async () => {
    const prisma = makePrisma();
    prisma.department.findUnique.mockResolvedValue(dept);

    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      makeService(prisma).addMember('dept_a', { userId: 'u_x' } as any)
    ).rejects.toThrow(NotFoundException);

    prisma.user.findUnique.mockResolvedValue({ id: 'u_x', status: 'disabled' });
    await expect(
      makeService(prisma).addMember('dept_a', { userId: 'u_x' } as any)
    ).rejects.toThrow('已停用');

    prisma.user.findUnique.mockResolvedValue({ id: 'u_x', status: 'active' });
    prisma.userDepartment.findUnique.mockResolvedValue({ id: 'udm_1' });
    await expect(
      makeService(prisma).addMember('dept_a', { userId: 'u_x' } as any)
    ).rejects.toThrow('已是部门成员');
  });

  it('首次归属自动成为主部门', async () => {
    const prisma = makePrisma();
    prisma.department.findUnique.mockResolvedValue(dept);
    prisma.user.findUnique.mockResolvedValue({ id: 'u_new', status: 'active' });
    prisma.userDepartment.findUnique.mockResolvedValue(null);
    prisma.userDepartment.count.mockResolvedValue(0);
    prisma.userDepartment.create.mockImplementation(({ data }: any) => Promise.resolve(data));

    const row: any = await makeService(prisma).addMember('dept_a', { userId: 'u_new' } as any);
    expect(row.isPrimary).toBe(true);
    expect(row.id).toMatch(/^udm_/);
    expect(prisma.userDepartment.updateMany).not.toHaveBeenCalled();
  });

  it('显式指定主部门：事务内先清旧主部门标记再落新行', async () => {
    const prisma = makePrisma();
    prisma.department.findUnique.mockResolvedValue(dept);
    prisma.user.findUnique.mockResolvedValue({ id: 'u_1', status: 'active' });
    prisma.userDepartment.findUnique.mockResolvedValue(null);
    prisma.userDepartment.count.mockResolvedValue(1); // 已有归属
    prisma.userDepartment.create.mockImplementation(({ data }: any) => Promise.resolve(data));

    await makeService(prisma).addMember('dept_a', { userId: 'u_1', isPrimary: true } as any);
    expect(prisma.userDepartment.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u_1', isPrimary: true },
      data: { isPrimary: false },
    });
    expect(prisma.userDepartment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isPrimary: true }) })
    );
    // 先清后设
    expect(prisma.userDepartment.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.userDepartment.create.mock.invocationCallOrder[0]
    );
  });

  it('不指定 isPrimary 且已有归属 → 以兼职身份加入，不动旧主部门', async () => {
    const prisma = makePrisma();
    prisma.department.findUnique.mockResolvedValue(dept);
    prisma.user.findUnique.mockResolvedValue({ id: 'u_1', status: 'active' });
    prisma.userDepartment.findUnique.mockResolvedValue(null);
    prisma.userDepartment.count.mockResolvedValue(1);
    prisma.userDepartment.create.mockImplementation(({ data }: any) => Promise.resolve(data));

    const row: any = await makeService(prisma).addMember('dept_a', { userId: 'u_1' } as any);
    expect(row.isPrimary).toBe(false);
    expect(prisma.userDepartment.updateMany).not.toHaveBeenCalled();
  });
});

describe('DepartmentService.removeMember', () => {
  it('非成员 → 404', async () => {
    const prisma = makePrisma();
    prisma.department.findUnique.mockResolvedValue({ id: 'dept_a', leaderId: null });
    prisma.userDepartment.findUnique.mockResolvedValue(null);
    await expect(makeService(prisma).removeMember('dept_a', 'u_x')).rejects.toThrow(
      NotFoundException
    );
  });

  it('负责人被移出时同步卸任；普通成员不动 leader', async () => {
    const prisma = makePrisma();
    prisma.department.findUnique.mockResolvedValue({ id: 'dept_a', leaderId: 'u_1' });
    prisma.userDepartment.findUnique.mockResolvedValue({ id: 'udm_1' });

    await makeService(prisma).removeMember('dept_a', 'u_1');
    expect(prisma.userDepartment.delete).toHaveBeenCalledWith({ where: { id: 'udm_1' } });
    expect(prisma.department.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { leader: { disconnect: true } } })
    );

    prisma.department.update.mockClear();
    await makeService(prisma).removeMember('dept_a', 'u_2');
    expect(prisma.department.update).not.toHaveBeenCalled();
  });
});
