import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/settings.dto';

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

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
}
