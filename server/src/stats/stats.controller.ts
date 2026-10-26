import { Controller, Get, Query, UseGuards } from '@nestjs/common';
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
  @Roles('owner', 'super_admin')
  users() {
    return this.service.usersUsage();
  }

  /** 成本分析：Token 按模型/按用户聚合 + 日趋势（仅 admin） */
  @Get('cost')
  @UseGuards(RolesGuard)
  @Roles('owner', 'super_admin')
  cost(@Query('days') days?: string) {
    return this.service.cost(Number(days) || 30);
  }

  /** 评价分析：点赞点踩汇总 + 日趋势 + 最近差评明细（仅 admin） */
  @Get('feedback')
  @UseGuards(RolesGuard)
  @Roles('owner', 'super_admin')
  feedback(@Query('days') days?: string) {
    return this.service.feedback(Number(days) || 30);
  }
}
