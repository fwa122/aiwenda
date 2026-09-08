import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module';
import { DocumentModule } from './document/document.module';
import { ConversationModule } from './conversation/conversation.module';
import { ChatModule } from './chat/chat.module';
import { SettingsModule } from './settings/settings.module';
import { ApiKeyModule } from './api-key/api-key.module';
import { StatsModule } from './stats/stats.module';
import { LogModule } from './log/log.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UserModule,
    KnowledgeBaseModule,
    DocumentModule,
    ConversationModule,
    ChatModule,
    SettingsModule,
    ApiKeyModule,
    StatsModule,
    LogModule,
  ],
})
export class AppModule {}
