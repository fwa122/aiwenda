import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 全库重嵌入状态读取。
 * embedding_state 表由 Python ai-service 自建自管（Prisma 迁移不感知），此处仅
 * 裸查 phase 列：phase != idle（running/finalizing/partial_failed）期间问答与
 * 向量检索一律拒绝——重嵌入按文档渐进替换向量，新旧渠道向量混检会产出垃圾结果。
 */
@Injectable()
export class EmbeddingStateService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 当前重嵌入阶段；状态表不存在（ai-service 未启动过）视为 idle，不阻塞主链路 */
  async getPhase(): Promise<string> {
    try {
      const rows = await this.prisma.$queryRaw<{ phase: string }[]>`
        SELECT phase FROM embedding_state WHERE id = 1
      `;
      return rows?.[0]?.phase || 'idle';
    } catch {
      return 'idle';
    }
  }

  /** 问答/向量检索入口守卫：重嵌入进行中返回 503（前端展示可读文案） */
  async assertChatAvailable(): Promise<void> {
    if ((await this.getPhase()) !== 'idle') {
      throw new ServiceUnavailableException(
        '知识库正在全库重嵌入，问答与检索暂不可用，完成后自动恢复',
      );
    }
  }

  /**
   * 用户侧可用性摘要（登录可读，供聊天页/知识库页横幅预警）。
   * 只输出 available + 面向用户的文案，不含渠道名/密钥/内部错误细节。
   * 健康判定与 ai-service _derive_health 同口径：最近失败晚于最近成功视为 down。
   * down 只预警不禁答（assertChatAvailable 不受影响），失败答案仍可由 LLM 兜底。
   */
  async getSummary(): Promise<{ available: boolean; message: string }> {
    try {
      const rows = await this.prisma.$queryRaw<{
        phase: string;
        last_ok_at: Date | null;
        last_error_at: Date | null;
      }[]>`
        SELECT phase, last_ok_at, last_error_at FROM embedding_state WHERE id = 1
      `;
      const row = rows?.[0];
      if (!row) return { available: true, message: '' };
      if (row.phase && row.phase !== 'idle') {
        return { available: false, message: '知识库正在更新，问答稍后恢复' };
      }
      const down =
        !!row.last_error_at && (!row.last_ok_at || row.last_error_at > row.last_ok_at);
      if (down) {
        return { available: false, message: '知识库问答暂时不可用，请联系管理员' };
      }
      return { available: true, message: '' };
    } catch {
      return { available: true, message: '' };
    }
  }
}
