import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { OperationLogService } from './operation-log.service';
import { LogController } from './log.controller';

@Global()
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [LogController],
  providers: [OperationLogService],
  exports: [OperationLogService],
})
export class LogModule {}
