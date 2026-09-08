import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AiServiceClient } from '../integrations/ai-service.client';
import { DocumentService } from './document.service';
import { DocumentCollectionController, DocumentController } from './document.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [DocumentCollectionController, DocumentController],
  providers: [DocumentService, AiServiceClient],
  exports: [DocumentService],
})
export class DocumentModule {}
