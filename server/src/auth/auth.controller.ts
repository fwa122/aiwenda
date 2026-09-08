import {
  Body,
  Controller,
  Ip,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  /** 自助注册：公开接口；成功后前端跳回登录页（不返回 token） */
  @Post('register')
  register(@Body() dto: RegisterDto, @Ip() ip: string) {
    return this.auth.register(dto, ip);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  logout() {
    // JWT 无状态，后端无需处理，前端删除本地 token 即可
    return null;
  }
}
