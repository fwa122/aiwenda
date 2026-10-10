import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  /**
   * 鉴权时查库比对 tokenVersion 与账号状态（P2 安全专项）：
   * - ver 不等：改密/封禁后自增过版本号，旧令牌立即 401（不等 access 自然过期）；
   *   老格式令牌无 ver 字段，按 0 处理，与存量用户 tokenVersion 默认值 0 兼容，升级不掉线
   * - status 非 active：封禁即时生效，消除「access 最长存活 2h」窗口
   * - 返回库内实时 role（此前返回 JWT 内快照，改角色需等令牌过期才生效）
   */
  async validate(payload: any) {
    if (!payload?.sub) {
      throw new UnauthorizedException();
    }
    if (payload.type === 'refresh') {
      // refresh 令牌只允许用于 /auth/refresh，不得作为 access token 访问业务接口
      throw new UnauthorizedException();
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, role: true, status: true, tokenVersion: true },
    });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException();
    }
    if ((payload.ver ?? 0) !== user.tokenVersion) {
      throw new UnauthorizedException();
    }
    return {
      id: user.id,
      username: user.username,
      role: user.role,
    };
  }
}
