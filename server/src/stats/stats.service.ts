import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** 时间范围参数收敛到安全区间 */
const clampDays = (days: number) =>
  Number.isFinite(days) ? Math.min(Math.max(Math.trunc(days), 1), 365) : 30;

@Injectable()
export class StatsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 用户用量排行：会话数/消息数/token 消耗，按 tokens 降序（仅 admin） */
  async usersUsage() {
    return this.prisma.$queryRaw`
      SELECT u.id,
             u.username,
             u.nickname,
             u.role,
             COUNT(c.id)::int AS conversations,
             COALESCE(SUM(c.message_count), 0)::int AS messages,
             COALESCE(SUM(c.token_used), 0)::int AS tokens,
             u.monthly_token_used AS "monthlyTokenUsed",
             u.monthly_token_limit AS "monthlyTokenLimit"
      FROM users u
      LEFT JOIN conversations c ON c.user_id = u.id
      GROUP BY u.id, u.username, u.nickname, u.role, u.monthly_token_used, u.monthly_token_limit
      ORDER BY tokens DESC`;
  }

  /**
   * 用量统计：近 7 天趋势 + 汇总。
   * daily_stats 由问答链路按日写入（P2 阶段接入）；当前空表时返回零值。
   */
  async usage() {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    const [weekRows, totalAgg, kbAgg] = await Promise.all([
      this.prisma.dailyStat.findMany({
        where: { date: { gte: weekStart } },
        orderBy: { date: 'asc' },
      }),
      this.prisma.dailyStat.aggregate({
        _sum: { questions: true, hitCount: true, tokens: true },
        _avg: { avgLatency: true },
        _max: { activeUsers: true },
      }),
      this.prisma.knowledgeBase.aggregate({
        _sum: { docCount: true, chunkCount: true },
      }),
    ]);

    const totalQuestions = totalAgg._sum.questions || 0;
    const totalHits = totalAgg._sum.hitCount || 0;

    const trend = weekRows.map((r) => ({
      date: r.date.toISOString().slice(5, 10).replace('-', '-'), // MM-DD
      questions: r.questions,
      hitRate: r.questions > 0 ? Number((r.hitCount / r.questions).toFixed(4)) : 0,
      avgLatency: r.avgLatency,
    }));

    return {
      trend,
      summary: {
        totalQuestions,
        weekQuestions: weekRows.reduce((s, r) => s + r.questions, 0),
        avgHitRate: totalQuestions > 0 ? Number((totalHits / totalQuestions).toFixed(4)) : 0,
        avgLatency: Math.round(totalAgg._avg.avgLatency || 0),
        totalTokens: Number(totalAgg._sum.tokens || 0),
        activeUsers: totalAgg._max.activeUsers || 0,
        docCount: kbAgg._sum.docCount || 0,
        chunkCount: kbAgg._sum.chunkCount || 0,
      },
    };
  }

  /**
   * 成本分析（仅 admin）：近 N 天 Token 消耗按模型/按用户聚合 + 日趋势。
   * tokens 数据取自 messages.meta（每条回答落库时写入 model + tokens），
   * 日趋势复用 daily_stats 日粒度表。
   */
  async cost(days: number) {
    const range = clampDays(days);

    const [byModel, byUser, byDept, trendRows, weekRows] = await Promise.all([
      this.prisma.$queryRaw`
        SELECT meta->>'model' AS model,
               COUNT(*)::int AS count,
               COALESCE(SUM((meta->'tokens'->>'total')::bigint), 0)::bigint AS tokens,
               COALESCE(SUM((meta->'tokens'->>'prompt')::bigint), 0)::bigint AS "promptTokens",
               COALESCE(SUM((meta->'tokens'->>'completion')::bigint), 0)::bigint AS "completionTokens",
               ROUND(AVG((meta->>'elapsedMs')::float)::numeric)::int AS "avgLatency"
        FROM messages
        WHERE role = 'assistant' AND status = 'done'
          AND meta->'tokens'->>'total' IS NOT NULL
          AND created_at >= NOW() - make_interval(days => ${range}::int)
        GROUP BY meta->>'model'
        ORDER BY tokens DESC`,
      this.prisma.$queryRaw`
        SELECT u.id, u.username, u.nickname, u.department,
               COUNT(m.id)::int AS questions,
               COALESCE(SUM((m.meta->'tokens'->>'total')::bigint), 0)::bigint AS tokens
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        JOIN users u ON u.id = c.user_id
        WHERE m.role = 'assistant' AND m.status = 'done'
          AND m.meta->'tokens'->>'total' IS NOT NULL
          AND m.created_at >= NOW() - make_interval(days => ${range}::int)
        GROUP BY u.id, u.username, u.nickname
        ORDER BY tokens DESC`,
      // 部门维度：按 users.department 聚合（成本分摊到部门），空值归入「未设置」
      this.prisma.$queryRaw`
        SELECT COALESCE(NULLIF(u.department, ''), '未设置') AS department,
               COUNT(DISTINCT u.id)::int AS users,
               COUNT(m.id)::int AS questions,
               COALESCE(SUM((m.meta->'tokens'->>'total')::bigint), 0)::bigint AS tokens
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        JOIN users u ON u.id = c.user_id
        WHERE m.role = 'assistant' AND m.status = 'done'
          AND m.meta->'tokens'->>'total' IS NOT NULL
          AND m.created_at >= NOW() - make_interval(days => ${range}::int)
        GROUP BY 1
        ORDER BY tokens DESC`,
      this.prisma.$queryRaw`
        SELECT date::text AS date, questions, tokens::bigint AS tokens
        FROM daily_stats
        WHERE date >= (CURRENT_DATE - make_interval(days => ${range - 1}::int))::date
        ORDER BY date ASC`,
      this.prisma.dailyStat.aggregate({
        _sum: { questions: true, tokens: true },
      }),
    ]);

    const trend = (trendRows as Array<{ date: string; questions: number; tokens: bigint }>).map(
      (r) => ({
        date: r.date.slice(5, 10), // MM-DD
        questions: Number(r.questions),
        tokens: Number(r.tokens),
      }),
    );

    return {
      days: range,
      byModel: (byModel as Array<Record<string, unknown>>).map((r) => ({
        ...r,
        tokens: Number(r.tokens),
        promptTokens: Number(r.promptTokens),
        completionTokens: Number(r.completionTokens),
      })),
      byUser: (byUser as Array<Record<string, unknown>>).map((r) => ({
        ...r,
        tokens: Number(r.tokens),
      })),
      byDept: (byDept as Array<Record<string, unknown>>).map((r) => ({
        ...r,
        tokens: Number(r.tokens),
      })),
      trend,
      total: {
        questions: Number(weekRows._sum.questions || 0),
        tokens: Number(weekRows._sum.tokens || 0),
      },
    };
  }

  /**
   * 评价分析（仅 admin）：点赞/点踩汇总 + 日趋势 + 最近差评明细（含原始提问）。
   * 差评明细用于答案质量闭环：定位差评对应的提问，指导知识库补漏。
   */
  async feedback(days: number) {
    const range = clampDays(days);

    const [summaryRows, trendRows, disliked] = await Promise.all([
      this.prisma.$queryRaw`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE feedback = 'like')::int AS likes,
               COUNT(*) FILTER (WHERE feedback = 'dislike')::int AS dislikes
        FROM messages
        WHERE role = 'assistant' AND status = 'done'
          AND created_at >= NOW() - make_interval(days => ${range}::int)`,
      this.prisma.$queryRaw`
        SELECT created_at::date::text AS date,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE feedback = 'like')::int AS likes,
               COUNT(*) FILTER (WHERE feedback = 'dislike')::int AS dislikes
        FROM messages
        WHERE role = 'assistant' AND status = 'done'
          AND created_at >= NOW() - make_interval(days => ${range}::int)
        GROUP BY 1 ORDER BY 1 ASC`,
      // 差证明细（v0.9.39 扩展）：原因/备注、差评人、引用文档、首引用库（回流默认目标）、
      // 已回流标记（该提问已存在于任一库的 hardcase 用例中）。question 保留截断展示，
      // reflowed 匹配用完整提问，避免长问题被截断后反查失效
      this.prisma.$queryRaw`
        SELECT m.id,
               m.conversation_id AS "conversationId",
               m.created_at AS "createdAt",
               LEFT(m.content, 200) AS answer,
               LEFT(q.content, 200) AS question,
               m.feedback_reason AS reason,
               m.feedback_note AS note,
               u.username,
               COALESCE(docs.docs, '[]'::json) AS "sourceDocs",
               fs.kb_id AS "refKbId",
               kb.name AS "refKbName",
               EXISTS (
                 SELECT 1 FROM eval_cases ec
                 WHERE ec.source = 'hardcase' AND ec.question = q.content
               ) AS reflowed
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        JOIN users u ON u.id = c.user_id
        LEFT JOIN LATERAL (
          SELECT q2.content FROM messages q2
          WHERE q2.conversation_id = m.conversation_id
            AND q2.role = 'user' AND q2.created_at <= m.created_at
          ORDER BY q2.created_at DESC LIMIT 1
        ) q ON true
        LEFT JOIN LATERAL (
          SELECT json_agg(DISTINCT d.name) AS docs
          FROM message_sources ms
          JOIN documents d ON d.id = ms.doc_id
          WHERE ms.message_id = m.id
        ) docs ON true
        LEFT JOIN LATERAL (
          SELECT ms.kb_id FROM message_sources ms
          WHERE ms.message_id = m.id
          ORDER BY ms.sort_order ASC, ms.id ASC
          LIMIT 1
        ) fs ON true
        LEFT JOIN knowledge_bases kb ON kb.id = fs.kb_id
        WHERE m.role = 'assistant' AND m.feedback = 'dislike'
        ORDER BY m.created_at DESC
        LIMIT 20`,
    ]);

    const summary = (summaryRows as Array<{ total: number; likes: number; dislikes: number }>)[0] || {
      total: 0,
      likes: 0,
      dislikes: 0,
    };
    const rated = summary.likes + summary.dislikes;

    return {
      days: range,
      summary: {
        total: Number(summary.total),
        likes: Number(summary.likes),
        dislikes: Number(summary.dislikes),
        // 评价率 = 已评价数 / 回答总数；满意度 = 点赞 / 已评价数
        ratedRate: summary.total > 0 ? Number((rated / summary.total).toFixed(4)) : 0,
        satisfaction: rated > 0 ? Number((summary.likes / rated).toFixed(4)) : 0,
      },
      // 日期统一为 MM-DD，与 /stats/cost、/stats/usage 的趋势口径一致
      trend: (trendRows as Array<{ date: string; total: number; likes: number; dislikes: number }>).map(
        (r) => ({ ...r, date: r.date.slice(5, 10) }),
      ),
      disliked: disliked as Array<{
        id: string;
        conversationId: string;
        createdAt: Date;
        answer: string;
        question: string | null;
        reason: string | null;
        note: string | null;
        username: string | null;
        sourceDocs: string[] | null;
        refKbId: string | null;
        refKbName: string | null;
        reflowed: boolean;
      }>,
    };
  }
}
