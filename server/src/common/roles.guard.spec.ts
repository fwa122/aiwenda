import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from './roles.decorator';

/** 构造 guard 与 reflector mock（getAllAndOverride 返回 @Roles 元数据） */
const makeGuard = (required: string[] | undefined, user: any) => {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(required),
  } as unknown as Reflector;
  const guard = new RolesGuard(reflector);
  const context: any = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  };
  return { guard, context };
};

describe('RolesGuard 角色 code 白名单', () => {
  it('未标记 @Roles 的接口直接放行', () => {
    const { guard, context } = makeGuard(undefined, null);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('@Roles() 空数组视为不限制', () => {
    const { guard, context } = makeGuard([], { role: 'viewer', dataScope: 'SELF' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('未登录（无 user.role）拒绝', () => {
    const { guard, context } = makeGuard(['admin'], null);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('角色不在白名单拒绝；命中放行', () => {
    const admin = { role: 'admin', dataScope: 'ALL' };
    const viewer = { role: 'viewer', dataScope: 'SELF' };
    const a = makeGuard(['admin'], admin);
    expect(a.guard.canActivate(a.context)).toBe(true);
    const v = makeGuard(['admin'], viewer);
    expect(() => v.guard.canActivate(v.context)).toThrow(ForbiddenException);
  });

  it('dataScope 与守卫无关（守卫只做 code 白名单，数据权限在服务层）', () => {
    // role 命中即放行，即使 dataScope 异常缺失
    const { guard, context } = makeGuard(['admin'], { role: 'admin' });
    expect(guard.canActivate(context)).toBe(true);
    expect(ROLES_KEY).toBe('roles');
  });
});
