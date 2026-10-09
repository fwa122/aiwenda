import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * 全局 Redis 客户端（P1-3）：限流计数与登录锁定共用。
 * 必须挂 error 监听——ioredis 未处理的 error 事件会直接 crash 进程；
 * Redis 短暂不可用时调用方各自 fail-open/fail-closed 自行决定。
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL');
        if (!url) throw new Error('REDIS_URL 未配置');
        const client = new Redis(url, { maxRetriesPerRequest: 2 });
        client.on('error', () => {});
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
