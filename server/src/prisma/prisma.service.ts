import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  // 采用懒连接：首次查询时由 Prisma 自动建连，
  // 避免 onModuleInit 阶段在 WSL2 下预热过慢阻塞启动
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
