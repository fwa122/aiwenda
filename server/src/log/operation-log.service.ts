import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface RecordLogInput {
  userId?: string;
  userName?: string;
  action: string;
  target?: string;
  ip?: string;
  result?: string;
}

@Injectable()
export class OperationLogService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 记录审计日志；失败不影响主流程（内部吞掉异常） */
  async record(input: RecordLogInput): Promise<void> {
    try {
      await this.prisma.operationLog.create({
        data: {
          userId: input.userId,
          userName: input.userName,
          action: input.action,
          target: input.target,
          ip: input.ip,
          result: input.result || '成功',
        },
      });
    } catch {
      /* 审计日志失败不阻断业务 */
    }
  }

  async list(query: { page?: number; pageSize?: number; action?: string }) {
    const where: Prisma.OperationLogWhereInput = {};
    if (query.action) where.action = { contains: query.action };

    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 10;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.operationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.operationLog.count({ where }),
    ]);

    // 契约字段名为 user（冗余的 userName），id 由拦截器 BigInt→Number
    const list = rows.map(({ userName, ...r }) => ({ ...r, user: userName }));
    return { list, total, page, pageSize };
  }
}
