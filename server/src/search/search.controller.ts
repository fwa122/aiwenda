import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { SearchQueryDto } from './search.dto';
import { SearchService } from './search.service';

/** 全局搜索（Ctrl+K）：会话标题 / 文档名 / 消息内容 三分组 */
@Controller('search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Get()
  search(@Query() query: SearchQueryDto, @CurrentUser('id') userId: string) {
    return this.service.globalSearch(userId, query.q, query.limit ?? 10);
  }
}
