import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ConversationModule } from '../conversation/conversation.module';
import { SettingsModule } from '../settings/settings.module';
import { AiServiceClient } from '../integrations/ai-service.client';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';

@Module({
  imports: [PrismaModule, AuthModule, ConversationModule, SettingsModule],
  controllers: [ChatController],
  providers: [ChatService, AiServiceClient],
})
export class ChatModule {}
