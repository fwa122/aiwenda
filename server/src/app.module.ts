import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type Redis from 'ioredis';
import { PrismaModule } from './prisma/prisma.module';
import { REDIS_CLIENT, RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module';
import { DocumentModule } from './document/document.module';
import { ConversationModule } from './conversation/conversation.module';
import { ChatModule } from './chat/chat.module';
import { FavoriteModule } from './favorite/favorite.module';
import { SearchModule } from './search/search.module';
import { SettingsModule } from './settings/settings.module';
import { ApiKeyModule } from './api-key/api-key.module';
import { StatsModule } from './stats/stats.module';
import { LogModule } from './log/log.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    // 全局限流兜底：单 IP 每分钟 300 次（nginx 反代后按真实客户端 IP 计数，
    // 见 main.ts 的 trust proxy）。高成本接口（问答/上传/登录）在各 controller 单独收紧。
    // P1-3：计数下沉 Redis——server 重启/多实例部署计数不丢，攻击者无法靠打重启清零
    ThrottlerModule.forRootAsync({
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),
    PrismaModule,
    AuthModule,
    UserModule,
    KnowledgeBaseModule,
    DocumentModule,
    ConversationModule,
    ChatModule,
    FavoriteModule,
    SearchModule,
    SettingsModule,
    ApiKeyModule,
    StatsModule,
    LogModule,
  ],
  providers: [
    // 全局 Guard：注册顺序在 JwtAuthGuard 之前，登录/注册等公开接口同样受保护
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
