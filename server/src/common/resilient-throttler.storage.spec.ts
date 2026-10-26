import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ResilientThrottlerStorage } from './resilient-throttler.storage';

/** 模拟 Redis 客户端：可注入故障 */
function makeRedis(overrides: Partial<{ incr: any; pexpire: any }> = {}) {
  return {
    incr: vi.fn().mockResolvedValue(1),
    pexpire: vi.fn().mockResolvedValue(1),
    ...overrides,
  } as any;
}

describe('ResilientThrottlerStorage（P0-A1 限流降级存储）', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('Redis 正常时走 INCR/PEXPIRE，返回累计命中数', async () => {
    const redis = makeRedis({ incr: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2) });
    const storage = new ResilientThrottlerStorage(redis);
    const r1 = await storage.increment('k', 60000, 300, 0, 'default');
    const r2 = await storage.increment('k', 60000, 300, 0, 'default');
    expect(r1.totalHits).toBe(1);
    expect(r2.totalHits).toBe(2);
    expect(redis.pexpire).toHaveBeenCalledWith('k', 60000);
  });

  it('Redis 故障时降级内存计数，请求不失败且计数连续', async () => {
    const redis = makeRedis({ incr: vi.fn().mockRejectedValue(new Error('CONN DOWN')) });
    const storage = new ResilientThrottlerStorage(redis);
    const r1 = await storage.increment('k', 60000, 300, 0, 'default');
    const r2 = await storage.increment('k', 60000, 300, 0, 'default');
    expect(r1.totalHits).toBe(1);
    expect(r2.totalHits).toBe(2);
    // 降级期间不应抛错（Promise 正常 resolve，guard 才能继续限流判断）
    expect(r2.timeToExpire).toBe(60);
  });

  it('内存计数按 TTL 过期：过期后重新从 1 起算', async () => {
    vi.useFakeTimers();
    const redis = makeRedis({ incr: vi.fn().mockRejectedValue(new Error('DOWN')) });
    const storage = new ResilientThrottlerStorage(redis);
    await storage.increment('k', 50, 300, 0, 'default'); // hits=1（TTL 50ms）
    vi.advanceTimersByTime(60); // 越过 TTL
    const r = await storage.increment('k', 50, 300, 0, 'default');
    expect(r.totalHits).toBe(1); // 重新起算
  });

  it('不同 key 的内存计数互不干扰', async () => {
    const redis = makeRedis({ incr: vi.fn().mockRejectedValue(new Error('DOWN')) });
    const storage = new ResilientThrottlerStorage(redis);
    await storage.increment('a', 60000, 300, 0, 'default');
    await storage.increment('a', 60000, 300, 0, 'default');
    const b = await storage.increment('b', 60000, 300, 0, 'default');
    expect(b.totalHits).toBe(1);
  });
});
