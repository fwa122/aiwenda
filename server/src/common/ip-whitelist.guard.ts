import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 设置缓存时长：白名单改动最多 30s 生效，避免每请求查库 */
const CACHE_TTL_MS = 30_000;

/** 解析白名单文本：逗号/分号/换行/空格分隔，支持精确 IP 与 IPv4 CIDR（如 192.168.1.0/24） */
export function parseWhitelist(raw: string | null | undefined): string[] {
  return String(raw || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 归一化：去 IPv4-mapped IPv6 前缀（nginx/express 常见 ::ffff:192.168.1.1 形态） */
export function normalizeIp(ip: string): string {
  const trimmed = String(ip || '').trim();
  return trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255 || !/^\d+$/.test(p)) return null;
    out = out * 256 + n;
  }
  return out >>> 0;
}

/** IPv4 CIDR 匹配；IPv6 段（不支持位运算）不匹配，回退到精确比对 */
function cidrMatch(ip: string, cidr: string): boolean {
  const [network, prefixRaw] = cidr.split('/');
  const prefix = Number(prefixRaw);
  const ipInt = ipv4ToInt(ip);
  const netInt = ipv4ToInt(network);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  if (ipInt === null || netInt === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return ((ipInt & mask) >>> 0) === ((netInt & mask) >>> 0);
}

/**
 * 判定 client IP 是否放行：
 * - 白名单为空 = 功能关闭，全放行
 * - loopback（127.0.0.1 / ::1）恒放行（防管理员误配把自己锁在本机外）
 * - 其余按精确 IP / CIDR 匹配
 */
export function isIpAllowed(ip: string, entries: string[]): boolean {
  if (!entries.length) return true;
  const norm = normalizeIp(ip);
  if (norm === '127.0.0.1' || norm === '::1') return true;
  for (const entry of entries) {
    if (entry.includes('/')) {
      if (cidrMatch(norm, entry)) return true;
    } else if (norm === entry) {
      return true;
    }
  }
  return false;
}

/**
 * IP 白名单守卫（全局，注册于 ThrottlerGuard 之后）：
 * settings.security.ipWhitelist 非空时，所有 /api/v1 路由仅放行白名单来源。
 * 设置查询失败时放行并告警（不放大故障——认证/限流等其他防线仍在；
 * 且库不可用时认证本身也无法通过）。
 */
@Injectable()
export class IpWhitelistGuard implements CanActivate {
  private readonly logger = new Logger(IpWhitelistGuard.name);
  private cache: { entries: string[]; fetchedAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async loadEntries(): Promise<string[]> {
    const now = Date.now();
    if (this.cache && now - this.cache.fetchedAt < CACHE_TTL_MS) return this.cache.entries;
    try {
      const row = await this.prisma.systemSetting.findUnique({
        where: { id: 1 },
        select: { security: true },
      });
      const entries = parseWhitelist((row?.security as any)?.ipWhitelist);
      this.cache = { entries, fetchedAt: now };
      return entries;
    } catch (e: any) {
      this.logger.warn(`读取白名单设置失败，本次请求放行：${e?.message}`);
      return [];
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const entries = await this.loadEntries();
    if (!entries.length) return true;
    const req = context.switchToHttp().getRequest();
    const ip = req?.ip || '';
    if (isIpAllowed(ip, entries)) return true;
    throw new ForbiddenException(`IP ${normalizeIp(ip) || '未知'} 不在访问白名单内`);
  }
}
