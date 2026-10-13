import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { SettingsModule } from '../settings/settings.module';
import { AiServiceClient } from '../integrations/ai-service.client';
import { KnowledgeBaseService } from './knowledge-base.service';
import { EvalCaseService } from './eval-case.service';
import { KnowledgeBaseController } from './knowledge-base.controller';

@Module({
  imports: [PrismaModule, AuthModule, SettingsModule],
  controllers: [KnowledgeBaseController],
  providers: [KnowledgeBaseService, EvalCaseService, AiServiceClient],
  exports: [KnowledgeBaseService],
})
export class KnowledgeBaseModule {}
