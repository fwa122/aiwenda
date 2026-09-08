import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { OperationLogService } from './operation-log.service';

@Controller('logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class LogController {
  constructor(private readonly service: OperationLogService) {}

  @Get('operations')
  list(@Query() query: any) {
    return this.service.list(query);
  }
}
