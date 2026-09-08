import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { genId } from '../common/id.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateConversationDto,
  UpdateConversationDto,
} from './dto/conversation.dto';

const DEFAULT_MODEL = 'glm-4-flash';

/** 契约中的引用来源结构（坐标 + 展示信息） */
export interface SourceView {
  id: string;
  index: number;
  kbId: string;
  kbName: string | null;
  docId: string;
  docName: string | null;
  docType: string | null;
  chunkId: string;
  chunkIndex: number;
  page: number;
  score: number;
  snippet: string | null;
}

@Injectable()
export class ConversationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private assertOwned = async (userId: string, id: string) => {
    const conv = await this.prisma.conversation.findFirst({
      where: { id, userId },
    });
    if (!conv) throw new NotFoundException('会话不存在');
    return conv;
  };

  async list(
    userId: string,
    query: { keyword?: string; page?: number; pageSize?: number }
  ) {
    const where: Prisma.ConversationWhereInput = { userId };
    if (query.keyword) where.title = { contains: query.keyword };

    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 20;

    const [list, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where,
        // 置顶优先，其次更新时间倒序（与前端 Mock 排序一致）
        orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return { list, total, page, pageSize };
  }

  async detail(userId: string, id: string) {
    const conv = await this.assertOwned(userId, id);
    const messages = await this.prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
    });
    const sourceMap = await this.resolveSources(messages.map((m) => m.id));

    return {
      ...conv,
      messages: messages.map((m) => ({
        ...m,
        sources: sourceMap.get(m.id) || [],
      })),
    };
  }

  async create(userId: string, dto: CreateConversationDto) {
    // 会话数配额：limit=0 视为不限制
    const quotaUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { conversationLimit: true },
    });
    if (quotaUser && quotaUser.conversationLimit > 0) {
      const count = await this.prisma.conversation.count({ where: { userId } });
      if (count >= quotaUser.conversationLimit) {
        throw new ForbiddenException(
          `会话数量已达上限（${quotaUser.conversationLimit} 个），请先清理旧会话`,
        );
      }
    }

    return this.prisma.conversation.create({
      data: {
        id: genId('conv'),
        userId,
        title: dto.title || '新对话',
        kbIds: (dto.kbIds || []) as Prisma.InputJsonValue,
        model: dto.model || DEFAULT_MODEL,
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateConversationDto) {
    await this.assertOwned(userId, id);
    const data: Prisma.ConversationUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.pinned !== undefined) data.pinned = dto.pinned;
    if (dto.kbIds !== undefined)
      data.kbIds = dto.kbIds as Prisma.InputJsonValue;
    if (dto.model !== undefined) data.model = dto.model;
    return this.prisma.conversation.update({ where: { id }, data });
  }

  async remove(userId: string, id: string) {
    await this.assertOwned(userId, id);
    await this.prisma.conversation.delete({ where: { id } });
    return { id };
  }

  async batchRemove(userId: string, ids: string[]) {
    const result = await this.prisma.conversation.deleteMany({
      where: { id: { in: ids }, userId },
    });
    return { ids, deleted: result.count };
  }

  /**
   * 消息反馈三态切换：like → dislike → null
   * 通过「先查消息所属会话归属」实现越权防护
   */
  async feedback(userId: string, messageId: string, type: 'like' | 'dislike' | null) {
    const msg = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: { select: { userId: true } } },
    });
    if (!msg || msg.conversation.userId !== userId) {
      throw new NotFoundException('消息不存在');
    }
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { feedback: type },
    });
    return { id: updated.id, feedback: updated.feedback };
  }

  /**
   * 批量解析引用来源：message_sources（坐标）+ documents + knowledge_bases + chunks(snippet)
   * 一次 IN 查询，供会话详情与 SSE references 复用
   */
  async resolveSources(messageIds: string[]): Promise<Map<string, SourceView[]>> {
    const map = new Map<string, SourceView[]>();
    if (!messageIds.length) return map;

    const rows = await this.prisma.messageSource.findMany({
      where: { messageId: { in: messageIds } },
      orderBy: [{ messageId: 'asc' }, { sortOrder: 'asc' }],
    });
    if (!rows.length) return map;

    const docIds = [...new Set(rows.map((r) => r.docId))];
    const chunkIds = [...new Set(rows.map((r) => r.chunkId).filter(Boolean))];
    const kbIds = [...new Set(rows.map((r) => r.kbId))];

    const [docs, chunks, kbs] = await Promise.all([
      this.prisma.document.findMany({
        where: { id: { in: docIds } },
        select: { id: true, name: true, type: true, kbId: true },
      }),
      chunkIds.length
        ? this.prisma.chunk.findMany({
            where: { id: { in: chunkIds } },
            select: { id: true, content: true },
          })
        : Promise.resolve([] as { id: string; content: string }[]),
      this.prisma.knowledgeBase.findMany({
        where: { id: { in: kbIds } },
        select: { id: true, name: true },
      }),
    ]);

    const docMap = new Map(docs.map((d) => [d.id, d]));
    const chunkMap = new Map(chunks.map((c) => [c.id, c.content]));
    const kbMap = new Map(kbs.map((k) => [k.id, k.name]));

    for (const r of rows) {
      const doc = docMap.get(r.docId);
      const list = map.get(r.messageId) || [];
      list.push({
        id: `src_${list.length + 1}`,
        index: list.length + 1,
        kbId: r.kbId,
        kbName: kbMap.get(r.kbId) || null,
        docId: r.docId,
        docName: doc?.name || null,
        docType: doc?.type || null,
        chunkId: r.chunkId,
        chunkIndex: r.chunkIndex,
        page: r.page,
        score: r.score,
        snippet: chunkMap.get(r.chunkId) || null,
      });
      map.set(r.messageId, list);
    }
    return map;
  }
}
