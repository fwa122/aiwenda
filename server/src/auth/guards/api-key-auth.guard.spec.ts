import { ExecutionContext, HttpException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeyAuthGuard, API_KEY_PREFIX } from './api-key-auth.guard';

/** PrismaService 测试替身：只提供密钥认证用到的方法 */
function makePrisma(overrides: Partial<Record<string, any>> = {}) {
  return {
    apiKey: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      ...(overrides.apiKey || {}),
    },
    user: {
      findUnique: vi.fn(),
      ...(overrides.user || {}),
    },
  } as any;
}

const OWNER = { id: 'u_owner', username: 'owner', role: 'admin', status: 'active' };

function makeKey(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'key_x1',
    userId: OWNER.id,
    keyHash: 'h',
    status: 'active',
    scope: ['kb_001', 'kb_002'],
    quotaPerDay: 1000,
    usedToday: 0,
    expiredAt: null,
    lastUsedAt: null,
    ...overrides,
  };
}

function ctxWith(req: any): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('ApiKeyAuthGuard', () => {
  let prisma: any;

  beforeEach(() => {
    prisma = makePrisma();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('authenticateApiKey（密钥认证与配额）', () => {
    it('无效密钥（哈希查无）→ 401', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(null);
      const guard = new ApiKeyAuthGuard(prisma);
      await expect(guard.authenticateApiKey(`${API_KEY_PREFIX}nope`)).rejects.toMatchObject({
        status: 401,
        message: '无效的 API 密钥',
      });
    });

    it('停用密钥 → 401；过期密钥 → 401', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(makeKey({ status: 'disabled' }));
      const guard = new ApiKeyAuthGuard(prisma);
      await expect(guard.authenticateApiKey(`${API_KEY_PREFIX}x`)).rejects.toMatchObject({
        status: 401,
        message: 'API 密钥已停用',
      });

      prisma.apiKey.findUnique.mockResolvedValue(
        makeKey({ expiredAt: new Date(Date.now() - 1000) }),
      );
      await expect(guard.authenticateApiKey(`${API_KEY_PREFIX}x`)).rejects.toMatchObject({
        status: 401,
        message: 'API 密钥已过期',
      });
    });

    it('scope 为空（未授权）→ 403，不消耗配额', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(makeKey({ scope: [] }));
      const guard = new ApiKeyAuthGuard(prisma);
      await expect(guard.authenticateApiKey(`${API_KEY_PREFIX}x`)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.apiKey.update).not.toHaveBeenCalled();
    });

    it('所属账号被禁用 → 401', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(makeKey());
      prisma.user.findUnique.mockResolvedValue({ ...OWNER, status: 'disabled' });
      const guard = new ApiKeyAuthGuard(prisma);
      await expect(guard.authenticateApiKey(`${API_KEY_PREFIX}x`)).rejects.toMatchObject({
        status: 401,
        message: '密钥所属账号不可用',
      });
    });

    it('当日用量达上限 → 429（跨日惰性重置：昨日用量满但已跨日则放行并清零）', async () => {
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
      prisma.user.findUnique.mockResolvedValue(OWNER);
      // 同日打满 → 429
      prisma.apiKey.findUnique.mockResolvedValue(
        makeKey({ usedToday: 1000, quotaPerDay: 1000, lastUsedAt: new Date() }),
      );
      let guard = new ApiKeyAuthGuard(prisma);
      await expect(guard.authenticateApiKey(`${API_KEY_PREFIX}x`)).rejects.toBeInstanceOf(HttpException);
      await expect(guard.authenticateApiKey(`${API_KEY_PREFIX}x`)).rejects.toMatchObject({ status: 429 });

      // 昨日打满，今天第一发 → 放行，usedToday 直接重置为 1
      prisma.apiKey.findUnique.mockResolvedValue(
        makeKey({ usedToday: 1000, quotaPerDay: 1000, lastUsedAt: yesterday }),
      );
      guard = new ApiKeyAuthGuard(prisma);
      const user = await guard.authenticateApiKey(`${API_KEY_PREFIX}x`);
      expect(user.apiKeyScope).toEqual(['kb_001', 'kb_002']);
      expect(prisma.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ usedToday: 1 }) }),
      );
    });

    it('正常调用：返回所有者主体 + scope，同日用量自增', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(
        makeKey({ usedToday: 3, lastUsedAt: new Date() }),
      );
      prisma.user.findUnique.mockResolvedValue(OWNER);
      const guard = new ApiKeyAuthGuard(prisma);
      const user = await guard.authenticateApiKey(`${API_KEY_PREFIX}x`);
      expect(user).toMatchObject({
        id: OWNER.id,
        username: OWNER.username,
        role: OWNER.role,
        apiKeyScope: ['kb_001', 'kb_002'],
        apiKeyId: 'key_x1',
      });
      expect(prisma.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ usedToday: { increment: 1 } }) }),
      );
    });
  });

  describe('canActivate（双通道路由）', () => {
    it('Bearer sk-kb-* → 走密钥认证，注入 req.user', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(makeKey());
      prisma.user.findUnique.mockResolvedValue(OWNER);
      const guard = new ApiKeyAuthGuard(prisma);
      const spy = vi.spyOn(guard, 'authenticateApiKey');
      const req: any = { headers: { authorization: `Bearer ${API_KEY_PREFIX}abc` } };
      await expect(guard.canActivate(ctxWith(req))).resolves.toBe(true);
      expect(spy).toHaveBeenCalledOnce();
      expect(req.user.apiKeyId).toBe('key_x1');
    });

    it('非密钥 Bearer → 透传 JWT 通道，不查密钥表', async () => {
      const guard = new ApiKeyAuthGuard(prisma);
      const req: any = { headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.x.y' } };
      // 单测环境无 passport jwt 策略注册：透传后应走 super 失败（而非查密钥表）
      await expect(guard.canActivate(ctxWith(req))).rejects.toBeTruthy();
      expect(prisma.apiKey.findUnique).not.toHaveBeenCalled();
    });

    it('无 Authorization 头 → 透传 JWT 通道（401）', async () => {
      const guard = new ApiKeyAuthGuard(prisma);
      await expect(guard.canActivate(ctxWith({ headers: {} }))).rejects.toBeTruthy();
      expect(prisma.apiKey.findUnique).not.toHaveBeenCalled();
    });
  });
});
