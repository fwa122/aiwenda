import { Body, Controller, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { AiServiceClient } from '../integrations/ai-service.client';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto, VerifyKeyDto } from './dto/settings.dto';

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(
    private readonly service: SettingsService,
    private readonly ai: AiServiceClient
  ) {}

  /** 所有登录用户可读（问答页需要读默认模型/检索参数） */
  @Get()
  get() {
    return this.service.get();
  }

  /** 仅管理员可改 */
  @Put()
  @UseGuards(RolesGuard)
  @Roles('admin')
  update(@Body() dto: UpdateSettingsDto) {
    return this.service.update(dto);
  }

  /** 嵌入渠道签名与全库重嵌入状态（admin）：签名 vs 当前配置变更检测 + 进度 + 成本预估 */
  @Get('embedding')
  @UseGuards(RolesGuard)
  @Roles('admin')
  embeddingState() {
    return this.ai.embeddingState();
  }

  /** 触发全库重嵌入（admin）：前端确认框已核对成本与不可逆风险 */
  @Post('embedding/reembed')
  @UseGuards(RolesGuard)
  @Roles('admin')
  triggerReembed() {
    return this.ai.triggerReembed();
  }

  /** 验证 LLM API Key 有效性（admin）：key 缺省时验证当前生效值（DB 覆盖 > .env） */
  @Post('verify-key')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @HttpCode(200)
  verifyKey(@Body() dto: VerifyKeyDto) {
    return this.ai.verifyKey(dto.provider, dto.key);
  }
}
