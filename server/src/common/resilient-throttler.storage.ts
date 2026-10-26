import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type Redis from 'ioredis';

/** 与 @nestjs/throttler 内部 ThrottlerStorageRecord 同构（该版本未从 index 导出） */
interface ThrottlerRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * 全局限流的降级存储（P0-A1）：包装 Redis 计数，Redis 故障时自动降级为
 * 单实例内存计数 + WARN 日志（30s 节流），恢复后自动回到 Redis。
 *
 * 背景：@nest-lab/throttler-storage-redis 的 increment 不捕获异常，Redis 一挂
 * ThrottlerGuard 直接抛错 → 全站所有请求 500（限流守卫是全局前置）。本类保证
 * 「限流组件故障 ≠ 全站不可用」：单实例内存计数在有 nginx 单入口部署下语义近似
 * （计数器只丢共享性，不丢拦截能力），多实例部署拦截精度略降但可用性优先。
 */
const WARN_INTERVAL_MS = 30_000;
const MEM_MAX_KEYS = 10_000;

export class ResilientThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger('ResilientThrottlerStorage');
  /** 内存兜底计数：key → { hits, expireAt(ms) }，惰性过期清理 */
  private readonly mem = new Map<string, { hits: number; expireAt: number }>();
  private lastWarnAt = 0;

  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ..._rest: unknown[]
  ): Promise<ThrottlerRecord> {
    try {
      const hits = await this.redis.incr(key);
      if (hits === 1) await this.redis.pexpire(key, ttl);
      return { totalHits: hits, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
    } catch (e) {
      const now = Date.now();
      if (now - this.lastWarnAt > WARN_INTERVAL_MS) {
        this.lastWarnAt = now;
        this.logger.error(`限流 Redis 不可用，降级为单实例内存计数：${(e as Error)?.message}`);
      }
      return this.memIncrement(key, ttl);
    }
  }

  private memIncrement(key: string, ttl: number): ThrottlerRecord {
    const now = Date.now();
    // 惰性清理：键量超阈值时清一遍过期项，仍超则丢弃最旧的一半（防内存被刷爆）
    if (this.mem.size > MEM_MAX_KEYS) {
      for (const [k, v] of this.mem) {
        if (v.expireAt <= now) this.mem.delete(k);
      }
      if (this.mem.size > MEM_MAX_KEYS) {
        const sorted = [...this.mem.entries()].sort((a, b) => a[1].expireAt - b[1].expireAt);
        for (let i = 0; i < Math.floor(MEM_MAX_KEYS / 2); i++) this.mem.delete(sorted[i][0]);
      }
    }
    const entry = this.mem.get(key);
    const hits = entry && entry.expireAt > now ? entry.hits + 1 : 1;
    this.mem.set(key, { hits, expireAt: now + ttl });
    return { totalHits: hits, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
  }
}
