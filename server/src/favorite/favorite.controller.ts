import { Body, Controller, Delete, Get, Ip, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { OperationLogService } from '../log/operation-log.service';
import { CreateFavoriteDto } from './dto/favorite.dto';
import { FavoriteService } from './favorite.service';

/** 回答收藏夹：收藏 / 列表 / 已收藏集合 / 取消收藏 */
@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoriteController {
  constructor(
    private readonly service: FavoriteService,
    private readonly log: OperationLogService
  ) {}

  // 路由顺序说明：/ids 为静态路径，必须先于任何含路径参数的 GET 路由声明；
  // 本控制器只有 GET /、GET /ids 与 DELETE /:id（方法不同不会互抢），
  // 若未来新增 GET /:id 详情接口，需继续保证其声明在 @Get('ids') 之后
  @Get('ids')
  ids(@CurrentUser('id') userId: string) {
    return this.service.listIds(userId);
  }

  @Get()
  list(@CurrentUser('id') userId: string, @Query() query: any) {
    return this.service.list(userId, query);
  }

  @Post()
  async create(
    @CurrentUser('id') userId: string,
    @CurrentUser('username') username: string,
    @Body() dto: CreateFavoriteDto,
    @Ip() ip: string
  ) {
    const fav = await this.service.create(userId, dto.messageId);
    this.log.record({
      userId,
      userName: username,
      action: 'favorite.create',
      target: (fav as any)?.question?.slice(0, 60) || dto.messageId,
      ip,
    });
    return fav;
  }

  @Delete(':id')
  async remove(
    @CurrentUser('id') userId: string,
    @CurrentUser('username') username: string,
    @Param('id') id: string,
    @Ip() ip: string
  ) {
    const result = await this.service.remove(userId, id);
    this.log.record({
      userId,
      userName: username,
      action: 'favorite.delete',
      target: id,
      ip,
    });
    return result;
  }
}
