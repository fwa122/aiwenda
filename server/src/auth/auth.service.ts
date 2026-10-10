import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type Redis from 'ioredis';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { withRoleName } from '../common/role.util';
import { genId } from '../common/id.util';
import { OperationLogService } from '../log/operation-log.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly log: OperationLogService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis
  ) {}

  /**
   * 自助注册：服务端强制 viewer 角色（请求体不接受任何角色字段，防越权）；
   * 受 system_settings.security.enableRegister 开关控制（默认开放）。
   */
  async register(dto: RegisterDto, ip?: string) {
    const setting = await this.prisma.systemSetting.findUnique({ where: { id: 1 } });
    const security: any = setting?.security || {};
    if (security.enableRegister === false) {
      throw new ForbiddenException('当前已关闭自助注册，请联系管理员开通账号');
    }

    const exist = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (exist) throw new ConflictException('用户名已存在');

    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          id: genId('user'),
          username: dto.username,
          passwordHash: await bcrypt.hash(dto.password, 10),
          nickname: dto.nickname || dto.username,
          email: dto.email,
          role: 'viewer',
          status: 'active',
        },
      });
    } catch (e) {
      // 并发注册兜底：前置 findUnique 与 create 之间存在竞态（TOCTOU），
      // 唯一约束冲突（P2002）同样按 409 语义返回，而非 500
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('用户名已存在');
      }
      throw e;
    }

    this.log.record({
      action: '注册账号',
      target: dto.username,
      userName: dto.username,
      ip,
      result: '成功',
    });

    return { id: user.id, username: user.username };
  }

  /**
   * 登录失败锁定（P1-2 账号级防爆破）：同一用户名 15 分钟窗口内累计失败 5 次锁 15 分钟。
   * P1-3 起计数下沉 Redis（server 重启不丢，多实例共享）；键：login:fail:{username} /
   * login:lock:{username}。Redis 不可用时锁定检查 fail-open（仍有 IP 限流兜底），
   * 不因锁组件故障导致全员无法登录。
   * 按用户名计数（不区分来源 IP）——防止单账号被分布式低频爆破；不存在
   * 的用户名同样计数，避免「探测账号是否存在」的旁路。
   */
  private static readonly MAX_LOGIN_FAILS = 5;
  private static readonly LOCK_WINDOW_SEC = 15 * 60;
  /** refresh token 有效期 7 天（轮换制：每次刷新旧令牌立即作废） */
  private static readonly REFRESH_TTL_SEC = 7 * 24 * 3600;
  private failKey(username: string) {
    return `login:fail:${username}`;
  }
  private lockKey(username: string) {
    return `login:lock:${username}`;
  }

  async validateUser(username: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user || user.status !== 'active') return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    return ok ? user : null;
  }

  async login(dto: LoginDto, ip?: string) {
    let locked: string | null = null;
    try {
      locked = await this.redis.get(this.lockKey(dto.username));
    } catch {
      // fail-open：Redis 故障不阻塞登录，仍有 IP 限流兜底
    }
    if (locked) {
      throw new HttpException('登录失败次数过多，账号已暂时锁定，请 15 分钟后再试', 429);
    }

    const user = await this.validateUser(dto.username, dto.password);
    if (!user) {
      try {
        const fails = await this.redis.incr(this.failKey(dto.username));
        if (fails === 1) {
          await this.redis.expire(this.failKey(dto.username), AuthService.LOCK_WINDOW_SEC);
        }
        if (fails >= AuthService.MAX_LOGIN_FAILS) {
          await this.redis.set(
            this.lockKey(dto.username),
            '1',
            'EX',
            AuthService.LOCK_WINDOW_SEC
          );
          // 锁已生效，失败计数清零，解锁后重新起算
          await this.redis.del(this.failKey(dto.username));
          // 仅在触发锁定时落审计日志（避免每次失败都写库放大攻击面）
          this.log
            .record({
              action: '登录失败锁定',
              target: dto.username,
              userName: dto.username,
              ip,
              result: `15 分钟窗口内累计失败 ${fails} 次`,
            })
            .catch(() => {});
        }
      } catch {
        // fail-open：同上
      }
      // 提示语保持与「用户不存在」一致，防用户名枚举
      throw new UnauthorizedException('用户名或密码不正确');
    }

    // 登录成功清空该账号的失败/锁定状态（失败时 DEL 便于测试与运维排查）
    await this.redis
      .del(this.failKey(dto.username), this.lockKey(dto.username))
      .catch(() => {});
    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      ver: user.tokenVersion,
    };
    const token = await this.jwt.signAsync(payload);
    const refreshToken = await this.issueRefreshToken(user.id, user.tokenVersion);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    return { token, refreshToken, user: this.toProfile(user) };
  }

  /**
   * JWT 刷新机制（P2）：access token 2 小时不变，refresh token 7 天轮换。
   * 白名单存 Redis（login:rt:{jti} → userId）：轮换即删旧发新，支持登出吊销；
   * Redis 故障时刷新 fail-closed（重新登录即可，安全优先），登录不受影响。
   */
  private async issueRefreshToken(userId: string, tokenVersion: number): Promise<string> {
    const jti = genId('rt');
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, type: 'refresh', jti, ver: tokenVersion },
      { expiresIn: '7d' }
    );
    // 白名单写入失败不阻塞登录：该令牌刷新时会被 Redis 校验拒绝（fail-closed）
    await this.redis
      .set(`login:rt:${jti}`, userId, 'EX', AuthService.REFRESH_TTL_SEC)
      .catch(() => {});
    return refreshToken;
  }

  /** 用 refresh token 换新令牌对：验签 + 类型 + 白名单三重校验，旧令牌一次性（轮换防重放） */
  async refresh(refreshToken: string) {
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(refreshToken);
    } catch {
      throw new UnauthorizedException('刷新令牌无效或已过期');
    }
    if (payload?.type !== 'refresh' || !payload.sub || !payload.jti) {
      throw new UnauthorizedException('刷新令牌无效');
    }
    const key = `login:rt:${payload.jti}`;
    let stored: string | null = null;
    try {
      stored = await this.redis.get(key);
    } catch {
      // Redis 故障 fail-closed
    }
    if (stored !== payload.sub) {
      // 不存在 = 已轮换/已吊销/Redis 不可用；重放旧令牌同样在此被拒
      throw new UnauthorizedException('刷新令牌已失效，请重新登录');
    }
    await this.redis.del(key).catch(() => {});
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('账号不存在或已停用');
    }
    // 改密/封禁会自增 tokenVersion：旧 refresh 即使还在白名单窗口内也一并拒绝
    if ((payload.ver ?? 0) !== user.tokenVersion) {
      throw new UnauthorizedException('刷新令牌已失效，请重新登录');
    }
    const token = await this.jwt.signAsync({
      sub: user.id,
      username: user.username,
      role: user.role,
      ver: user.tokenVersion,
    });
    const newRefreshToken = await this.issueRefreshToken(user.id, user.tokenVersion);
    return { token, refreshToken: newRefreshToken, user: this.toProfile(user) };
  }

  /** 登出吊销 refresh token（access token 仍存活至自然过期，≤2h 风险窗口） */
  async logout(refreshToken?: string) {
    if (!refreshToken) return null;
    try {
      const payload = await this.jwt.verifyAsync(refreshToken);
      if (payload?.type === 'refresh' && payload.jti) {
        await this.redis.del(`login:rt:${payload.jti}`).catch(() => {});
      }
    } catch {
      // 令牌本身无效则无需吊销
    }
    return null;
  }

  /** 去掉密码字段，返回安全的用户对象（含 roleName） */
  toProfile(user: Prisma.UserGetPayload<{}>) {
    const { passwordHash, ...rest } = user;
    return withRoleName(rest);
  }
}
