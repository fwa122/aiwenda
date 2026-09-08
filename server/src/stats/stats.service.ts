import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
}
