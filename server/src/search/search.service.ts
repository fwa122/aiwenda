import { Inject, Injectable } from '@nestjs/common';
import { canReadKb } from '../common/kb-access';
import { PrismaService } from '../prisma/prisma.service';

/** snippet 截取：定位 q 首次出现位置，取前后各 60 字符拼 … */
function buildSnippet(content: string, q: string): string {
  const idx = content.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return content.slice(0, 120);
  const start = Math.max(0, idx - 60);
  const end = Math.min(content.length, idx + q.length + 60);
  return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`;
}

@Injectable()
export class SearchService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * 全局搜索：会话标题 / 可见知识库下的文档名 / 本人消息内容，一次返回三分组。
   * 文档与消息都只暴露当前用户有权看到的内容（kb-access 可见性 + 会话归属）。
   */
  async globalSearch(userId: string, q: string, limit = 10) {
    // 1. 会话标题匹配（仅本人会话）
    const conversations = await this.prisma.conversation.findMany({
      where: { userId, title: { contains: q } },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { id: true, title: true, updatedAt: true },
    });

    // 2. 文档名匹配：先按 kb-access 可见性取当前用户可见的 kbId 列表
    //    （internal/public 对所有登录用户可见，private 仅 owner 与 admin，与 document.service 口径一致）
    const [user, allKbs] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
      this.prisma.knowledgeBase.findMany({
        select: { id: true, userId: true, visibility: true },
      }),
    ]);
    const visibleKbIds =
      user?.role === 'admin'
        ? allKbs.map((kb) => kb.id)
        : allKbs
            .filter((kb) =>
              canReadKb(kb, { id: userId, username: '', role: user?.role || 'viewer' }),
            )
            .map((kb) => kb.id);

    const documents = visibleKbIds.length
      ? await this.prisma.document.findMany({
          where: {
            AND: [{ kbId: { in: visibleKbIds } }, { name: { contains: q } }],
          },
          take: 5,
          select: { id: true, name: true, kbId: true },
        })
      : [];
    // 附 kbName：一次 IN 查询取知识库名映射
    const docKbIds = [...new Set(documents.map((d) => d.kbId))];
    const kbRows = docKbIds.length
      ? await this.prisma.knowledgeBase.findMany({
          where: { id: { in: docKbIds } },
          select: { id: true, name: true },
        })
      : [];
    const kbNameMap = new Map(kbRows.map((kb) => [kb.id, kb.name]));

    // 3. 消息内容：pg_trgm 相似匹配（% 操作符）+ ILIKE 兜底短词。
    //    参数化查询防注入；pg_trgm 扩展/索引未就绪时降级为空，不让搜索整体 500。
    const like = `%${q}%`;
    let messages: Array<{
      conversationId: string;
      conversationTitle: string;
      content: string;
      role: string;
      createdAt: Date;
      snippet: string;
    }> = [];
    try {
      const rows = (await this.prisma.$queryRaw`
        SELECT m.conversation_id AS "conversationId", c.title AS "conversationTitle",
               m.content, m.role, m.created_at AS "createdAt"
        FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE c.user_id = ${userId} AND (m.content % ${q} OR m.content ILIKE ${like})
        ORDER BY similarity(m.content, ${q}) DESC
        LIMIT ${limit}`) as Array<{
        conversationId: string;
        conversationTitle: string;
        content: string;
        role: string;
        createdAt: Date;
      }>;
      messages = rows.map((m) => ({ ...m, snippet: buildSnippet(String(m.content || ''), q) }));
    } catch {
      messages = [];
    }

    return {
      conversations,
      documents: documents.map((d) => ({ ...d, kbName: kbNameMap.get(d.kbId) || '' })),
      messages,
    };
  }
}
