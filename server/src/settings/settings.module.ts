import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AiServiceClient } from '../integrations/ai-service.client';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { EmbeddingStateService } from './embedding-state.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [SettingsController],
  providers: [SettingsService, AiServiceClient, EmbeddingStateService],
  exports: [SettingsService, EmbeddingStateService],
})
export class SettingsModule {}
