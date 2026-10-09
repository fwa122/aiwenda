import {
  Body,
  Controller,
  Ip,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
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

  /** 自助注册：公开接口；成功后前端跳回登录页（不返回 token） */
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
}
