import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ConversationService } from './conversation.service';
import { ConversationController, MessageController } from './conversation.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ConversationController, MessageController],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
