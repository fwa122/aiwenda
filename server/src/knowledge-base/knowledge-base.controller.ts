import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { OperationLogService } from '../log/operation-log.service';
import { AiServiceClient } from '../integrations/ai-service.client';
import { KnowledgeBaseService } from './knowledge-base.service';
import { CreateKbDto, UpdateKbDto } from './dto/knowledge-base.dto';

@Controller('knowledge')
@UseGuards(JwtAuthGuard)
export class KnowledgeBaseController {
  constructor(
    private readonly service: KnowledgeBaseService,
    private readonly log: OperationLogService,
    private readonly ai: AiServiceClient
  ) {}

  @Get()
  list(@Query() query: any, @CurrentUser() user: any) {
    return this.service.list(query, user);
  }

  /** 已就绪知识库（问答页下拉） */
  @Get('options')
  options(@CurrentUser() user: any) {
    return this.service.options(user);
  }

  @Get(':id')
  detail(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.detail(id, user);
  }

  @Post()
  create(@Body() dto: CreateKbDto, @CurrentUser() user: any, @Ip() ip: string) {
    const result = this.service.create(dto, user);
    // 失败时异常交给 Nest 处理，日志仅在成功后记录（避免 unhandled rejection 崩溃进程）
    result
      .then((kb) => {
        this.log.record({ userId: user.id, userName: user.username, action: '创建知识库', target: kb.name, ip });
      })
      .catch(() => {});
    return result;
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateKbDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any, @Ip() ip: string) {
    const result = this.service.remove(id, user);
    result
      .then((kb) => {
        this.log.record({ userId: user.id, userName: user.username, action: '删除知识库', target: kb?.name || id, ip });
      })
      .catch(() => {});
    return result;
  }

  @Post(':id/reindex')
  reindex(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.reindex(id, user);
  }

  /**
   * 检索测试：只检索不生成（转发 Python /internal/search）。
   * 注意必须放在 @Get(':id') 等路由之后无冲突（POST 方法不同）。
   */
  @Post('retrieval-test')
  async retrievalTest(@Body() body: any, @CurrentUser() user: any) {
    const { kbId, query, topK = 5, threshold = 0.28, hybrid = false, rerank = false } = body || {};
    // 防越权：指定的知识库必须当前用户可见
    if (kbId) await this.service.detail(kbId, user);
    const started = Date.now();
    const upstream = await this.ai.search({
      kbIds: kbId ? [kbId] : [],
      query,
      topK,
      threshold,
      hybrid,
      rerank,
    });
    return {
      query,
      topK,
      threshold,
      hybrid,
      rerank,
      elapsedMs: Date.now() - started,
      total: upstream.total,
      results: upstream.results,
    };
  }
}
