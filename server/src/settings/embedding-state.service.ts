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
}
