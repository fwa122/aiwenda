import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { StatsService } from './stats.service';

@Controller('stats')
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(private readonly service: StatsService) {}

  @Get('usage')
  usage() {
    return this.service.usage();
  }

  /** 用户用量排行（仅 admin） */
  @Get('users')
  @UseGuards(RolesGuard)
  @Roles('admin')
  users() {
    return this.service.usersUsage();
  }
}
