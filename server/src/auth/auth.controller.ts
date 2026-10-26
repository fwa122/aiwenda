import {
  Body,
  Controller,
  Get,
  Ip,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto, ResetPasswordDto, SendEmailCodeDto } from './dto/register.dto';
import { RefreshDto, LogoutDto } from './dto/refresh.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  // 按 IP 限流，抬高密码爆破成本（未登录接口，只能按 IP 计数）
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.auth.login(dto, ip);
  }

  /**
   * 刷新令牌：access token 过期后用 refresh token 静默续期（轮换制，旧令牌即废）。
   * 未登录接口按 IP 限流；频率高于登录（多端/多标签页场景）。
   */
  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  /** 自助注册：公开接口；需邮箱验证码（先经 /auth/email-code 获取）；成功后前端跳回登录页 */
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() dto: RegisterDto, @Ip() ip: string) {
    return this.auth.register(dto, ip);
  }

  /** 登出：吊销 refresh token（请求体可空——仅清前端本地状态也能工作） */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  logout(@Body() dto?: LogoutDto) {
    return this.auth.logout(dto?.refreshToken);
  }

  // ==========================================================================
  // v0.9.47 注册邮箱验证 + 忘记密码（邮箱验证码重置，免原密码）
  // ==========================================================================

  /** 图形验证码（自绘 SVG，5 分钟有效、一次性）：发送邮箱验证码的前置防刷 */
  @Get('captcha')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getCaptcha() {
    return this.auth.getCaptcha();
  }

  /**
   * 发送邮箱验证码：图形码校验 → 场景分流（register 校验邮箱占用 / reset 防枚举静默）
   * → SMTP 发信（未配置 503）。限流收紧到 3 次/分（邮件轰炸防护，图形码后第二道闸）。
   */
  @Post('email-code')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  sendEmailCode(@Body() dto: SendEmailCodeDto, @Ip() ip: string) {
    return this.auth.sendEmailCode(dto, ip);
  }

  /** 忘记密码重置：邮箱验证码校验 → 改密 + tokenVersion 自增（全端下线） */
  @Post('reset-password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  resetPassword(@Body() dto: ResetPasswordDto, @Ip() ip: string) {
    return this.auth.resetPassword(dto, ip);
  }
}
