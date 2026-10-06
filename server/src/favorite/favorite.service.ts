import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { genId } from '../common/id.util';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 收藏快照中的来源条目：从 message_sources 拍平而来。
 * 快照策略下冗余存 docName —— 原文档删除后收藏仍可完整展示来源信息。
 */
export interface FavoriteSource {
  /** 兼容 Prisma InputJsonValue 的索引签名 */
  [key: string]: string | number | null;
  index: number;
  docId: string;
  docName: string | null;
  kbId: string;
  page: number;
  score: number;
}

@Injectable()
export class FavoriteService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * 收藏一条回答（快照策略）：
   * 拷贝问题 / 回答 / 引用来源坐标，消息与文档后续删除均不影响收藏内容。
   * 同一用户对同一消息重复收藏 → 409。
   */
  async create(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        conversation: { select: { userId: true } },
        sources: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!message) throw new NotFoundException('消息不存在');
    if (message.conversation.userId !== userId) {
      throw new ForbiddenException('无权收藏该消息');
    }

    // 问题取该回答前最近的一条 user 消息
    const prevUser = await this.prisma.message.findFirst({
      where: {
        conversationId: message.conversationId,
        role: 'user',
        createdAt: { lt: message.createdAt },
      },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    });

    // 来源拍平 + 冗余解析 docName（一次 IN 查询）
    const docIds = [...new Set(message.sources.map((s) => s.docId))];
    const docs = await this.prisma.document.findMany({
      where: { id: { in: docIds } },
      select: { id: true, name: true },
    });
    const docNameMap = new Map(docs.map((d) => [d.id, d.name]));
    const sources: FavoriteSource[] = message.sources.map((s, i) => ({
      index: i + 1,
      docId: s.docId,
      docName: docNameMap.get(s.docId) || null,
      kbId: s.kbId,
      page: s.page,
      score: s.score,
    }));

    // 所属知识库取第一条来源（通用回答无来源时为 null，收藏夹筛选时自然被排除）
    const kbId = message.sources[0]?.kbId ?? null;

    try {
      return await this.prisma.favorite.create({
        data: {
          id: genId('fav'),
          userId,
          messageId,
          conversationId: message.conversationId,
          kbId,
          question: prevUser?.content || '',
          answer: message.content,
          sources: sources as Prisma.InputJsonValue[],
        },
      });
    } catch (e) {
      // (userId, messageId) 唯一冲突：视为重复收藏
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('已收藏');
      }
      throw e;
    }
  }

  /** 收藏列表（分页，可按知识库筛选），附会话标题用于「查看会话」 */
  async list(
    userId: string,
    query: { kbId?: string; page?: number; pageSize?: number }
  ) {
    const where: Prisma.FavoriteWhereInput = { userId };
    if (query.kbId) where.kbId = query.kbId;

    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 20;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.favorite.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.favorite.count({ where }),
    ]);

    // Favorite 与 Conversation 仅为弱关联（无外键），批量取标题后映射
    const convIds = [...new Set(rows.map((r) => r.conversationId))];
    const convs = await this.prisma.conversation.findMany({
      where: { id: { in: convIds } },
      select: { id: true, title: true },
    });
    const titleMap = new Map(convs.map((c) => [c.id, c.title]));

    return {
      list: rows.map((r) => ({ ...r, conversationTitle: titleMap.get(r.conversationId) || '' })),
      total,
      page,
      pageSize,
    };
  }

  /** 当前用户已收藏的 messageId 集合（聊天页初始化星标高亮，轻量接口） */
  async listIds(userId: string) {
    const rows = await this.prisma.favorite.findMany({
      where: { userId },
      select: { messageId: true },
    });
    return rows.map((r) => r.messageId);
  }

  /** 取消收藏：仅归属人可删 */
  async remove(userId: string, id: string) {
    const fav = await this.prisma.favorite.findUnique({ where: { id } });
    if (!fav) throw new NotFoundException('收藏不存在');
    if (fav.userId !== userId) throw new ForbiddenException('无权删除该收藏');
    await this.prisma.favorite.delete({ where: { id } });
    return { id };
  }
}
