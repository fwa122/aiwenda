import { describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import {
  IpWhitelistGuard,
  parseWhitelist,
  normalizeIp,
  isIpAllowed,
} from './ip-whitelist.guard';

describe('parseWhitelist（白名单文本解析）', () => {
  it('空值返回空数组', () => {
    expect(parseWhitelist('')).toEqual([]);
    expect(parseWhitelist(null)).toEqual([]);
    expect(parseWhitelist(undefined)).toEqual([]);
  });

  it('逗号分隔', () => {
    expect(parseWhitelist('192.168.1.1,10.0.0.1')).toEqual(['192.168.1.1', '10.0.0.1']);
  });

  it('混合分隔符（逗号/分号/空格/换行）', () => {
    expect(parseWhitelist('192.168.1.1; 10.0.0.1\n172.16.0.1')).toEqual([
      '192.168.1.1', '10.0.0.1', '172.16.0.1',
    ]);
  });

  it('trim 空白', () => {
    expect(parseWhitelist('  192.168.1.1  ,  10.0.0.1  ')).toEqual(['192.168.1.1', '10.0.0.1']);
  });
});

describe('normalizeIp（IP 归一化）', () => {
  it('IPv4 原样返回', () => {
    expect(normalizeIp('192.168.1.1')).toBe('192.168.1.1');
  });

  it('IPv4-mapped IPv6 去前缀', () => {
    expect(normalizeIp('::ffff:192.168.1.1')).toBe('192.168.1.1');
  });

  it('IPv6 loopback 原样返回', () => {
    expect(normalizeIp('::1')).toBe('::1');
  });

  it('空值安全处理', () => {
    expect(normalizeIp('')).toBe('');
  });
});

describe('isIpAllowed（IP 放行判定）', () => {
  it('白名单为空 = 功能关闭，全放行', () => {
    expect(isIpAllowed('1.2.3.4', [])).toBe(true);
  });

  it('loopback 恒放行（防误锁）', () => {
    expect(isIpAllowed('127.0.0.1', ['10.0.0.1'])).toBe(true);
    expect(isIpAllowed('::1', ['10.0.0.1'])).toBe(true);
  });

  it('精确 IP 匹配', () => {
    expect(isIpAllowed('192.168.1.5', ['192.168.1.5', '10.0.0.1'])).toBe(true);
    expect(isIpAllowed('192.168.1.6', ['192.168.1.5', '10.0.0.1'])).toBe(false);
  });

  it('IPv4-mapped IPv6 归一化后匹配', () => {
    expect(isIpAllowed('::ffff:192.168.1.5', ['192.168.1.5'])).toBe(true);
  });

  it('CIDR /24 匹配', () => {
    expect(isIpAllowed('192.168.1.50', ['192.168.1.0/24'])).toBe(true);
    expect(isIpAllowed('192.168.2.50', ['192.168.1.0/24'])).toBe(false);
  });

  it('CIDR /16 匹配', () => {
    expect(isIpAllowed('10.10.50.1', ['10.10.0.0/16'])).toBe(true);
    expect(isIpAllowed('10.11.50.1', ['10.10.0.0/16'])).toBe(false);
  });

  it('CIDR /32 等价精确匹配', () => {
    expect(isIpAllowed('10.0.0.1', ['10.0.0.1/32'])).toBe(true);
    expect(isIpAllowed('10.0.0.2', ['10.0.0.1/32'])).toBe(false);
  });

  it('混合精确 + CIDR', () => {
    const entries = ['10.0.0.1', '192.168.1.0/24', '172.16.0.0/12'];
    expect(isIpAllowed('10.0.0.1', entries)).toBe(true);
    expect(isIpAllowed('192.168.1.99', entries)).toBe(true);
    expect(isIpAllowed('172.31.255.254', entries)).toBe(true);
    expect(isIpAllowed('8.8.8.8', entries)).toBe(false);
  });

  it('IPv6 不做 CIDR 匹配，仅精确比对', () => {
    expect(isIpAllowed('2001:db8::1', ['2001:db8::1'])).toBe(true);
    expect(isIpAllowed('2001:db8::2', ['2001:db8::1'])).toBe(false);
  });
});

describe('IpWhitelistGuard（守卫行为）', () => {
  const makeGuard = (security: any, findUnique?: any) => {
    const prisma = {
      systemSetting: { findUnique: findUnique ?? (async () => ({ security })) },
    };
    return new IpWhitelistGuard(prisma as any);
  };
  const ctx = (ip: string) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ ip }) }) }) as any;

  it('白名单为空直接放行', async () => {
    const guard = makeGuard({ ipWhitelist: '' });
    await expect(guard.canActivate(ctx('8.8.8.8'))).resolves.toBe(true);
  });

  it('命中白名单放行', async () => {
    const guard = makeGuard({ ipWhitelist: '10.0.0.1, 192.168.1.0/24' });
    await expect(guard.canActivate(ctx('192.168.1.7'))).resolves.toBe(true);
  });

  it('未命中抛 403 并带 IP 信息', async () => {
    const guard = makeGuard({ ipWhitelist: '10.0.0.1' });
    await expect(guard.canActivate(ctx('8.8.8.8'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('设置行不存在（未播种）视为功能关闭', async () => {
    const guard = makeGuard(undefined, async () => null);
    await expect(guard.canActivate(ctx('8.8.8.8'))).resolves.toBe(true);
  });

  it('设置查询失败放行（fail-open，认证/限流等其他防线仍在）', async () => {
    const guard = makeGuard(undefined, async () => {
      throw new Error('db down');
    });
    await expect(guard.canActivate(ctx('8.8.8.8'))).resolves.toBe(true);
  });

  it('缓存 TTL 内不重复查库', async () => {
    let calls = 0;
    const guard = makeGuard(undefined, async () => {
      calls += 1;
      return { security: { ipWhitelist: '10.0.0.1' } };
    });
    await guard.canActivate(ctx('10.0.0.1'));
    await guard.canActivate(ctx('10.0.0.1'));
    expect(calls).toBe(1);
  });
});
