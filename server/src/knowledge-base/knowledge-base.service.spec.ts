import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeBaseService } from './knowledge-base.service';

const makePrisma = () => {
  const prisma: any = {
    knowledgeBase: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    kbMember: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    userDepartment: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    department: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn().mockImplementation(async (arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(prisma)
    ),
  };
  return prisma;
};

const makeService = (prisma: any) =>
  new KnowledgeBaseService(prisma, { invalidateAnswerCache: vi.fn() } as any);

// 超管判定基于 dataScope=ALL（配置化鉴权），不再看 role 字符串
const admin = { id: 'u_ad', username: 'ad', role: 'admin', dataScope: 'ALL' };
const owner = { id: 'u_o', username: 'o', role: 'editor', dataScope: 'SELF' };
const stranger = { id: 'u_s', username: 's', role: 'viewer', dataScope: 'SELF' };

describe('KnowledgeBaseService.detail 可见性矩阵', () => {
  it('DEPT 库：同部门用户只读可见（myRole=null），异部门 403', async () => {
    const prisma = makePrisma();
    prisma.knowledgeBase.findUnique.mockResolvedValue({
      id: 'kb_1', userId: 'u_o', visibility: 'DEPT', orgId: 'dept_a',
    });
    prisma.department.findUnique.mockResolvedValue({ path: '/dept_a' });
    // 同部门（含子树前缀命中）
    prisma.userDepartment.findMany.mockResolvedValue([{ department: { path: '/dept_a' } }]);
    const kb: any = await makeService(prisma).detail('kb_1', stranger);
    expect(kb.myRole).toBeNull();

    prisma.userDepartment.findMany.mockResolvedValue([{ department: { path: '/dept_x' } }]);
    await expect(makeService(prisma).detail('kb_1', stranger)).rejects.toThrow(ForbiddenException);
  });

  it('PUBLIC 库：陌生用户可读；PRIVATE 库：非成员 403', async () => {
    const prisma = makePrisma();
    prisma.knowledgeBase.findUnique.mockResolvedValue({
      id: 'kb_1', userId: 'u_o', visibility: 'PUBLIC', orgId: null,
    });
    await makeService(prisma).detail('kb_1', stranger);

    prisma.knowledgeBase.findUnique.mockResolvedValue({
      id: 'kb_1', userId: 'u_o', visibility: 'PRIVATE', orgId: null,
    });
    await expect(makeService(prisma).detail('kb_1', stranger)).rejects.toThrow(ForbiddenException);
  });

  it('PRIVATE 库成员 viewer 可读；admin 恒可读', async () => {
    const prisma = makePrisma();
    prisma.knowledgeBase.findUnique.mockResolvedValue({
      id: 'kb_1', userId: 'u_o', visibility: 'PRIVATE', orgId: null,
    });
    prisma.kbMember.findUnique.mockResolvedValue({ role: 'viewer' });
    const kb: any = await makeService(prisma).detail('kb_1', stranger);
    expect(kb.myRole).toBe('viewer');

    prisma.kbMember.findUnique.mockResolvedValue(null);
    await makeService(prisma).detail('kb_1', admin);
  });
});

describe('KnowledgeBaseService.list 部门过滤', () => {
  it('非 admin：where 携带 PUBLIC/DEPT(可见部门)/个人/成员 四路 OR', async () => {
    const prisma = makePrisma();
    // 用户在 dept_a/dept_b：祖先链 dept_a、dept_b 上的 DEPT 库均可见
    prisma.userDepartment.findMany.mockResolvedValue([
      { department: { path: '/dept_a/dept_b' } },
    ]);
    prisma.department.findMany.mockResolvedValue([
      { id: 'dept_a', path: '/dept_a' },
      { id: 'dept_b', path: '/dept_a/dept_b' },
    ]);
    await makeService(prisma).list({}, stranger);
    const where = prisma.knowledgeBase.findMany.mock.calls[0][0].where.AND[0];
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { visibility: 'PUBLIC' },
        { visibility: 'DEPT', orgId: { in: ['dept_a', 'dept_b'] } },
        { userId: stranger.id },
        { members: { some: { userId: stranger.id } } },
      ])
    );
  });

  it('admin：无可见性过滤', async () => {
    const prisma = makePrisma();
    await makeService(prisma).list({}, admin);
    const where = prisma.knowledgeBase.findMany.mock.calls[0][0].where.AND[0];
    expect(where).toEqual({});
    expect(prisma.userDepartment.findMany).not.toHaveBeenCalled();
  });
});

describe('KnowledgeBaseService.create', () => {
  it('orgId 默认取创建人主部门，visibility 默认 PUBLIC（注册即全员可读）', async () => {
    const prisma = makePrisma();
    prisma.userDepartment.findFirst.mockResolvedValue({ deptId: 'dept_a' });
    prisma.knowledgeBase.create.mockImplementation(({ data }: any) => Promise.resolve(data));
    const kb: any = await makeService(prisma).create({ name: '新库' } as any, owner);
    expect(kb.orgId).toBe('dept_a');
    expect(kb.visibility).toBe('PUBLIC');
    expect(kb.myRole).toBe('owner');
  });

  it('无主部门 → orgId 为空；显式传 DEPT 生效', async () => {
    const prisma = makePrisma();
    prisma.userDepartment.findFirst.mockResolvedValue(null);
    prisma.knowledgeBase.create.mockImplementation(({ data }: any) => Promise.resolve(data));
    const kb: any = await makeService(prisma).create(
      { name: '新库', visibility: 'DEPT' } as any,
      owner
    );
    expect(kb.orgId).toBeNull();
    expect(kb.visibility).toBe('DEPT');
  });

  it('显式传 orgId 优先于主部门（校验部门存在），供管理员为他人部门建库', async () => {
    const prisma = makePrisma();
    prisma.userDepartment.findFirst.mockResolvedValue({ deptId: 'dept_mine' });
    prisma.department.findUnique.mockResolvedValue({ id: 'dept_target' });
    prisma.knowledgeBase.create.mockImplementation(({ data }: any) => Promise.resolve(data));
    const kb: any = await makeService(prisma).create(
      { name: '新库', visibility: 'DEPT', orgId: 'dept_target' } as any,
      admin
    );
    expect(kb.orgId).toBe('dept_target');
    expect(prisma.userDepartment.findFirst).not.toHaveBeenCalled();
  });

  it('显式 orgId 不存在 → 400', async () => {
    const prisma = makePrisma();
    prisma.department.findUnique.mockResolvedValue(null);
    await expect(
      makeService(prisma).create({ name: '新库', orgId: 'dept_ghost' } as any, admin)
    ).rejects.toThrow('归属部门不存在');
  });
});

describe('KnowledgeBaseService.update 可见范围门控', () => {
  const writableKb = {
    id: 'kb_1', userId: 'u_o', visibility: 'PRIVATE', orgId: 'dept_a',
    retrieverConfig: {}, llmConfig: {},
  };

  it('editor 成员改 visibility → 403（仅 owner/admin 可调可见范围）', async () => {
    const prisma = makePrisma();
    prisma.knowledgeBase.findUnique.mockResolvedValue({ ...writableKb });
    prisma.kbMember.findUnique.mockResolvedValue({ role: 'editor' });
    await expect(
      makeService(prisma).update('kb_1', { visibility: 'PUBLIC' } as any, stranger)
    ).rejects.toThrow(ForbiddenException);
  });

  it('owner 可改 visibility 与 orgId；orgId 不存在 → 400', async () => {
    const prisma = makePrisma();
    prisma.knowledgeBase.findUnique.mockResolvedValue({ ...writableKb });
    prisma.department.findUnique.mockResolvedValue({ id: 'dept_x' });
    await makeService(prisma).update(
      'kb_1', { visibility: 'DEPT', orgId: 'dept_x' } as any, owner
    );
    const data = prisma.knowledgeBase.update.mock.calls[0][0].data;
    expect(data.visibility).toBe('DEPT');
    expect(data.orgId).toBe('dept_x');

    prisma.department.findUnique.mockResolvedValue(null);
    await expect(
      makeService(prisma).update('kb_1', { orgId: 'dept_gone' } as any, owner)
    ).rejects.toThrow(BadRequestException);
  });

  it('editor 仅改内容（不含可见范围）→ 正常放行', async () => {
    const prisma = makePrisma();
    prisma.knowledgeBase.findUnique.mockResolvedValue({ ...writableKb });
    prisma.kbMember.findUnique.mockResolvedValue({ role: 'editor' });
    await makeService(prisma).update('kb_1', { name: '改名' } as any, stranger);
    expect(prisma.knowledgeBase.update).toHaveBeenCalled();
  });
});
