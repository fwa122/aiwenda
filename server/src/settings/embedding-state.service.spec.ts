import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { EmbeddingStateService } from './embedding-state.service';

/** 全库重嵌入状态读取（表由 ai-service 自管，此处仅裸查 phase） */
const makeService = (queryRaw: ReturnType<typeof vi.fn>) =>
  new EmbeddingStateService({ $queryRaw: queryRaw } as any);

describe('EmbeddingStateService', () => {
  it('状态表不存在（ai-service 未启动过）视为 idle，不阻塞主链路', async () => {
    const queryRaw = vi.fn().mockRejectedValue(new Error('relation "embedding_state" does not exist'));
    const service = makeService(queryRaw);
    await expect(service.getPhase()).resolves.toBe('idle');
    await expect(service.assertChatAvailable()).resolves.toBeUndefined();
  });

  it('查询结果为空视为 idle', async () => {
    const service = makeService(vi.fn().mockResolvedValue([]));
    await expect(service.getPhase()).resolves.toBe('idle');
  });

  it('idle 放行问答与检索', async () => {
    const service = makeService(vi.fn().mockResolvedValue([{ phase: 'idle' }]));
    await expect(service.getPhase()).resolves.toBe('idle');
    await expect(service.assertChatAvailable()).resolves.toBeUndefined();
  });

  it('running / finalizing / partial_failed 均拒绝问答（防新旧向量混检）', async () => {
    for (const phase of ['running', 'finalizing', 'partial_failed']) {
      const service = makeService(vi.fn().mockResolvedValue([{ phase }]));
      await expect(service.assertChatAvailable()).rejects.toThrow(ServiceUnavailableException);
      await expect(service.assertChatAvailable()).rejects.toThrow('全库重嵌入');
    }
  });

  // ===== getSummary：用户侧可用性摘要（横幅预警用，down 只预警不禁答） =====

  it('summary：表不存在/查询失败按可用兜底（软提示不阻塞）', async () => {
    const service = makeService(vi.fn().mockRejectedValue(new Error('relation does not exist')));
    await expect(service.getSummary()).resolves.toEqual({ available: true, message: '' });
  });

  it('summary：重嵌入进行中提示更新中', async () => {
    const service = makeService(
      vi.fn().mockResolvedValue([{ phase: 'running', last_ok_at: new Date(), last_error_at: null }]),
    );
    const out = await service.getSummary();
    expect(out.available).toBe(false);
    expect(out.message).toContain('正在更新');
  });

  it('summary：最近失败晚于最近成功视为渠道异常', async () => {
    const okAt = new Date('2026-10-23T10:00:00Z');
    const errAt = new Date('2026-10-23T10:05:00Z');
    const service = makeService(
      vi.fn().mockResolvedValue([{ phase: 'idle', last_ok_at: okAt, last_error_at: errAt }]),
    );
    const out = await service.getSummary();
    expect(out.available).toBe(false);
    expect(out.message).toContain('暂时不可用');
  });

  it('summary：失败早于成功（已恢复）或从未失败均可用', async () => {
    const okAt = new Date('2026-10-23T10:00:00Z');
    const errAt = new Date('2026-10-23T09:55:00Z');
    const recovered = makeService(
      vi.fn().mockResolvedValue([{ phase: 'idle', last_ok_at: okAt, last_error_at: errAt }]),
    );
    await expect(recovered.getSummary()).resolves.toEqual({ available: true, message: '' });

    const healthy = makeService(
      vi.fn().mockResolvedValue([{ phase: 'idle', last_ok_at: okAt, last_error_at: null }]),
    );
    await expect(healthy.getSummary()).resolves.toEqual({ available: true, message: '' });
  });

  it('summary：仅失败无成功记录同样视为异常', async () => {
    const service = makeService(
      vi.fn().mockResolvedValue([{ phase: 'idle', last_ok_at: null, last_error_at: new Date() }]),
    );
    const out = await service.getSummary();
    expect(out.available).toBe(false);
  });
});
