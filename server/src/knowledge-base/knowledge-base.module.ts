import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AiServiceClient } from '../integrations/ai-service.client';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KnowledgeBaseController } from './knowledge-base.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [KnowledgeBaseController],
  providers: [KnowledgeBaseService, AiServiceClient],
  exports: [KnowledgeBaseService],
})
export class KnowledgeBaseModule {}
