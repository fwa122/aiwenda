import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { SettingsService } from './settings.service';

type Row = Record<string, any>;

/** 单行表原始行（含明文 apiKeys，模拟 DB 返回） */
const makeRow = (apiKeys: any): Row => ({
  id: 1,
  model: {},
  retrieval: {},
  security: {},
  storage: {},
  apiKeys,
  updatedAt: new Date(),
});

const makePrisma = (existing: Row | null) => ({
  systemSetting: {
    findUnique: vi.fn().mockResolvedValue(existing),
    create: vi.fn(),
    update: vi.fn().mockImplementation(({ data }) =>
      Promise.resolve({ ...(existing || ({} as Row)), ...data })
    ),
  },
});

const makeService = (prisma: any, ai: any = { reloadKeys: vi.fn() }) =>
  new SettingsService(prisma, ai);

describe('SettingsService.apiKeys', () => {
  it('get() 脱敏：仅返回 configured/tail/source，不外泄明文', async () => {
    const prisma = makePrisma(makeRow({ zhipu: 'sk-abcd1234' }));
    const res: any = await makeService(prisma).get();
    expect(res.apiKeys.zhipu).toEqual({ configured: true, tail: '1234', source: 'db' });
    expect(res.apiKeys.qianwen).toEqual({ configured: false, tail: '', source: 'none' });
    expect(JSON.stringify(res)).not.toContain('sk-abcd1234');
  });

  it('update()：undefined 不变更，未提及渠道的既有值保留', async () => {
    const prisma = makePrisma(makeRow({ zhipu: 'old-zhipu', qianwen: 'old-qw' }));
    const res: any = await makeService(prisma).update({
      apiKeys: { moonshot: 'new-kimi' },
    } as any);
    const data = prisma.systemSetting.update.mock.calls[0][0].data;
    expect(data.apiKeys).toEqual({ zhipu: 'old-zhipu', qianwen: 'old-qw', moonshot: 'new-kimi' });
    expect(res.apiKeys.moonshot).toEqual({ configured: true, tail: 'kimi', source: 'db' });
  });

  it('update()：空串清除对应渠道（回落 .env），其余保留', async () => {
    const prisma = makePrisma(makeRow({ zhipu: 'old-zhipu', qianwen: 'old-qw' }));
    await makeService(prisma).update({ apiKeys: { zhipu: '' } } as any);
    const data = prisma.systemSetting.update.mock.calls[0][0].data;
    expect(data.apiKeys).toEqual({ qianwen: 'old-qw' });
  });

  it('update()：全部清空时整列置 JsonNull', async () => {
    const prisma = makePrisma(makeRow({ zhipu: '  ' }));
    await makeService(prisma).update({ apiKeys: { zhipu: '  ' } } as any);
    const data = prisma.systemSetting.update.mock.calls[0][0].data;
    expect(data.apiKeys).toBe(Prisma.JsonNull);
  });

  it('update()：key 值 trim 且超长截断（300 上限）', async () => {
    const prisma = makePrisma(makeRow(null));
    await makeService(prisma).update({ apiKeys: { zhipu: `  ${'k'.repeat(400)}  ` } } as any);
    const data = prisma.systemSetting.update.mock.calls[0][0].data;
    expect((data.apiKeys as Record<string, string>).zhipu).toHaveLength(300);
  });

  it('update() 返回值同样脱敏（update 直返 prisma 行，明文易漏）', async () => {
    const prisma = makePrisma(makeRow(null));
    const res: any = await makeService(prisma).update({
      apiKeys: { zhipu: 'sk-secret-9999' },
    } as any);
    expect(JSON.stringify(res)).not.toContain('sk-secret-9999');
    expect(res.apiKeys.zhipu).toEqual({ configured: true, tail: '9999', source: 'db' });
  });

  it('update() 保存成功后推送 Python key 缓存失效（fire-and-forget）', async () => {
    const prisma = makePrisma(makeRow(null));
    const ai = { reloadKeys: vi.fn() };
    await makeService(prisma, ai).update({ apiKeys: { zhipu: 'k' } } as any);
    expect(ai.reloadKeys).toHaveBeenCalledTimes(1);
  });

  it('update() 未传 apiKeys 时不触碰该列、不推送 reload', async () => {
    const prisma = makePrisma(makeRow({ zhipu: 'keep' }));
    const ai = { reloadKeys: vi.fn() };
    await makeService(prisma, ai).update({ model: { temperature: 0.5 } } as any);
    const data = prisma.systemSetting.update.mock.calls[0][0].data;
    expect(data.apiKeys).toBeUndefined();
    expect(ai.reloadKeys).not.toHaveBeenCalled();
  });
});
