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
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { OperationLogService } from '../log/operation-log.service';
import { AiServiceClient } from '../integrations/ai-service.client';
import { EmbeddingStateService } from '../settings/embedding-state.service';
import { KnowledgeBaseService } from './knowledge-base.service';
import { EvalCaseService } from './eval-case.service';
import { KbMemberService } from './kb-member.service';
import { CreateKbDto, UpdateKbDto } from './dto/knowledge-base.dto';
import { CreateEvalCaseDto, ImportEvalCasesDto, UpdateEvalCaseDto } from './dto/eval-case.dto';
import { AddMemberDto, UpdateMemberDto } from './dto/kb-member.dto';

@Controller('knowledge')
@UseGuards(JwtAuthGuard)
export class KnowledgeBaseController {
  constructor(
    private readonly service: KnowledgeBaseService,
    private readonly evalCases: EvalCaseService,
    private readonly members: KbMemberService,
    private readonly log: OperationLogService,
    private readonly ai: AiServiceClient,
    private readonly embeddingState: EmbeddingStateService
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

  // 建库：站长/超级管理员（v0.9.61 四级——管理员不参与知识库模块，普通用户仅问答）
  @Post()
  @UseGuards(RolesGuard)
  @Roles('owner', 'super_admin')
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
    // 重嵌入禁答守卫：与问答同一口径，防止新旧渠道向量混检误导调参判断
    await this.embeddingState.assertChatAvailable();
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
      route: upstream.route,
    };
  }

  // ==========================================================================
  // 检索评测用例（golden QA，浏览器端逐条跑检索测试计分）
  // 读与检索测试同口径（可见即可读），写与知识库配置同口径（owner / admin）
  // ==========================================================================

  @Get(':id/eval-cases')
  listEvalCases(@Param('id') id: string, @CurrentUser() user: any) {
    return this.evalCases.list(id, user);
  }

  @Post(':id/eval-cases')
  createEvalCase(@Param('id') id: string, @Body() dto: CreateEvalCaseDto, @CurrentUser() user: any) {
    return this.evalCases.create(id, dto, user);
  }

  @Post(':id/eval-cases/import')
  importEvalCases(
    @Param('id') id: string,
    @Body() dto: ImportEvalCasesDto,
    @CurrentUser() user: any
  ) {
    return this.evalCases.import(id, dto, user);
  }

  @Put(':id/eval-cases/:caseId')
  updateEvalCase(
    @Param('id') id: string,
    @Param('caseId') caseId: string,
    @Body() dto: UpdateEvalCaseDto,
    @CurrentUser() user: any
  ) {
    return this.evalCases.update(id, caseId, dto, user);
  }

  @Delete(':id/eval-cases/:caseId')
  removeEvalCase(
    @Param('id') id: string,
    @Param('caseId') caseId: string,
    @CurrentUser() user: any
  ) {
    return this.evalCases.remove(id, caseId, user);
  }

  // ==========================================================================
  // 知识库成员管理（协作授权）
  // 管理口径：仅 owner / admin 可增删改成员（editor 可写内容但无权管理成员）；
  // 读口径：private 库成员可见（kb-access），成员角色实时查库，移除即失效
  // ==========================================================================

  @Get(':id/members')
  listMembers(@Param('id') id: string, @CurrentUser() user: any) {
    return this.members.list(id, user);
  }

  /** 邀请下拉候选用户（排除 owner 与已有成员） */
  @Get(':id/member-candidates')
  memberCandidates(
    @Param('id') id: string,
    @Query('keyword') keyword: string,
    @CurrentUser() user: any
  ) {
    return this.members.candidates(id, keyword, user);
  }

  @Post(':id/members')
  addMember(
    @Param('id') id: string,
    @Body() dto: AddMemberDto,
    @CurrentUser() user: any,
    @Ip() ip: string
  ) {
    const result = this.members.add(id, dto, user);
    result
      .then((m) => {
        this.log.record({
          userId: user.id,
          userName: user.username,
          action: '添加知识库成员',
          target: `${m.user.nickname || m.user.username}（${m.role}）`,
          ip,
        });
      })
      .catch(() => {});
    return result;
  }

  @Put(':id/members/:memberId')
  updateMember(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberDto,
    @CurrentUser() user: any
  ) {
    return this.members.update(id, memberId, dto, user);
  }

  @Delete(':id/members/:memberId')
  removeMember(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: any,
    @Ip() ip: string
  ) {
    const result = this.members.remove(id, memberId, user);
    result
      .then(() => {
        this.log.record({ userId: user.id, userName: user.username, action: '移除知识库成员', target: memberId, ip });
      })
      .catch(() => {});
    return result;
  }
}
