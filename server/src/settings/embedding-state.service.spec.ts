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
});
