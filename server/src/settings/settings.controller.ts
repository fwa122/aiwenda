import { Body, Controller, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { AiServiceClient } from '../integrations/ai-service.client';
import { EmbeddingStateService } from './embedding-state.service';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto, VerifyKeyDto } from './dto/settings.dto';

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(
    private readonly service: SettingsService,
    private readonly ai: AiServiceClient,
    private readonly embeddingStateService: EmbeddingStateService,
  ) {}

  /** 仅管理员可读（v0.9.60）：设置页专属——模型/检索/安全策略/存储/缓存配置对普通用户不可见。
   *  普通用户不需要读它（问答参数由服务端注入；个人资料走 /user/profile） */
  @Get()
  @UseGuards(RolesGuard)
  @Roles('owner', 'super_admin')
  get() {
    return this.service.get();
  }

  /** 仅管理员可改 */
  @Put()
  @UseGuards(RolesGuard)
  @Roles('owner', 'super_admin')
  update(@Body() dto: UpdateSettingsDto) {
    return this.service.update(dto);
  }

  /** 嵌入渠道签名与全库重嵌入状态（admin）：签名 vs 当前配置变更检测 + 进度 + 成本预估 + 健康度 */
  @Get('embedding')
  @UseGuards(RolesGuard)
  @Roles('owner', 'super_admin')
  embeddingState() {
    return this.ai.embeddingState();
  }

  /** 嵌入渠道可用性摘要（所有登录用户可读）：聊天页/知识库页横幅预警用。
   *  仅含 available/message，不含渠道名/密钥/内部错误细节 */
  @Get('embedding/summary')
  embeddingSummary() {
    return this.embeddingStateService.getSummary();
  }

  /** 主动探测嵌入渠道可用性（admin）：真实发一次嵌入调用并写回健康记录，
   *  供设置页「检测可用性」按钮与重嵌入前阻断检查 */
  @Post('embedding/probe')
  @UseGuards(RolesGuard)
  @Roles('owner', 'super_admin')
  @HttpCode(200)
  probeEmbedding() {
    return this.ai.probeEmbedding();
  }

  /** 触发全库重嵌入（admin）：前端确认框已核对成本与不可逆风险。
   *  触发即失效全部答案缓存（重嵌入后检索结果整体刷新，缓存答案不再可靠） */
  @Post('embedding/reembed')
  @UseGuards(RolesGuard)
  @Roles('owner', 'super_admin')
  triggerReembed() {
    const result = this.ai.triggerReembed();
    this.ai.invalidateAnswerCache();
    return result;
  }

  /** 验证 LLM API Key 有效性（admin）：key 缺省时验证当前生效值（DB 覆盖 > .env） */
  @Post('verify-key')
  @UseGuards(RolesGuard)
  @Roles('owner', 'super_admin')
  @HttpCode(200)
  verifyKey(@Body() dto: VerifyKeyDto) {
    return this.ai.verifyKey(dto.provider, dto.key);
  }
}
