import {
  BadRequestException,
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
import { ROLE_NAME } from '../common/role.util';
import { genId } from '../common/id.util';
import { assertUsernameAllowed, hashPassword, rehashIfNeeded } from '../common/password.security';
import { OperationLogService } from '../log/operation-log.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { LoginDto } from './dto/login.dto';
import { RegisterDto, ResetPasswordDto, SendEmailCodeDto } from './dto/register.dto';
import { CaptchaService } from './captcha.service';
import { EmailCodeService, MailService } from './mail.service';

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly log: OperationLogService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly captcha: CaptchaService,
    private readonly emailCode: EmailCodeService,
    private readonly mail: MailService
  ) {}

  /**
   * 自助注册：服务端强制 viewer 角色（请求体不接受任何角色字段，防越权）；
   * 受 system_settings.security.enableRegister 开关控制（默认开放）。
   * v0.9.47：邮箱必填唯一 + 邮箱验证码校验（先经 /auth/email-code 获取，前置图形验证码防刷）。
   */
  async register(dto: RegisterDto, ip?: string) {
    const setting = await this.prisma.systemSetting.findUnique({ where: { id: 1 } });
    const security: any = setting?.security || {};
    if (security.enableRegister === false) {
      throw new ForbiddenException('当前已关闭自助注册，请联系管理员开通账号');
    }

    // 邮箱归一（与 sendEmailCode/resetPassword 同规则）：发码端按小写存码，
    // 注册端若用原始大小写查码必失配（大写邮箱用户 100% 复现「验证码已过期」）；
    // 归一后入库也保证唯一约束大小写无关，忘记密码按小写必能查到
    const email = dto.email.trim().toLowerCase();
    const nickname = dto.nickname?.trim() || dto.username.trim();

    // 保留名校验（不依赖库查询，最前置）；密码规则仅 DTO 基线（8~32 位、字母+数字）
    assertUsernameAllowed(dto.username);

    // 邮箱验证码校验（一次性，先于一切库查询：无效码不消耗任何资源探测账号）
    await this.emailCode.verify('register', email, dto.emailCode);

    const exist = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (exist) throw new ConflictException('用户名已存在');
    const emailTaken = await this.prisma.user.findUnique({
      where: { email },
    });
    if (emailTaken) throw new ConflictException('该邮箱已被注册');

    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          id: genId('user'),
          username: dto.username,
          passwordHash: await hashPassword(dto.password),
          nickname,
          email,
          role: 'viewer',
          status: 'active',
        },
      });
    } catch (e) {
      // 并发注册兜底：前置 findUnique 与 create 之间存在竞态（TOCTOU），
      // 用户名/邮箱唯一约束冲突（P2002）同样按 409 语义返回，而非 500
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('用户名或邮箱已被注册');
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

    // 注册即登录（低摩擦入门）：与 login/refresh 同构返回令牌对与用户档案
    return this.issueSession(user);
  }

  /** 图形验证码签发（controller 委托，保持 captcha 私有） */
  getCaptcha() {
    return this.captcha.issue();
  }

  /** 当日 24 点前的剩余秒数（每日配额 Redis TTL 用） */
  private static secondsUntilMidnight() {
    const d = new Date();
    d.setHours(24, 0, 0, 0);
    return Math.max(60, Math.floor((d.getTime() - Date.now()) / 1000));
  }

  /**
   * 每日发送配额（B4 邮件轰炸防护）：图形码挡住脚本后，仍可能被换 IP 对同一邮箱
   * 骚扰发信——按「邮箱 10 封/天 + IP 30 封/天」双维度限额，TTL 到当日 24 点自动清零。
   * Redis 故障 fail-open（不因配额组件故障阻断正常发码）。
   */
  private async assertDailyQuota(key: string, limit: number, message: string) {
    try {
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, AuthService.secondsUntilMidnight());
      if (n > limit) throw new HttpException(message, 429);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      // Redis 故障：放行
    }
  }

  /**
   * 发送邮箱验证码（register / reset 两场景）：图形验证码前置（防脚本轰炸），
   * 每日双维度配额（邮箱 10/天、IP 30/天，防轰炸），再按场景分流——register 校验
   * 邮箱未被占用；reset 无绑定用户时静默成功（防「该邮箱是否存在」枚举）。
   * 码存 Redis 5 分钟 + 60s 发送冷却，SMTP 未配置 503。
   */
  async sendEmailCode(dto: SendEmailCodeDto, ip?: string) {
    await this.captcha.verify(dto.captchaId, dto.captchaCode);
    const email = dto.email.trim().toLowerCase();

    // register 场景占用检查前置到配额之前：已注册邮箱必不发码，早拒绝——
    // 否则骚扰者可白烧受害者邮箱的每日 10 封配额，致其当天收不到任何验证码
    if (dto.scene === 'register') {
      const taken = await this.prisma.user.findUnique({ where: { email } });
      if (taken) throw new ConflictException('该邮箱已被注册');
    }

    await this.assertDailyQuota(
      `emailcode:daily:email:${email}`,
      10,
      '该邮箱今日验证码发送次数已达上限，请明日再试'
    );
    if (ip) {
      await this.assertDailyQuota(
        `emailcode:daily:ip:${ip}`,
        30,
        '当前来源今日验证码发送次数已达上限，请明日再试'
      );
    }

    if (dto.scene !== 'register') {
      // reset 场景：不存在的绑定静默放行（不暴露邮箱归属），也不产生冷却
      const user = await this.prisma.user.findFirst({ where: { email, status: 'active' } });
      if (!user) return { sent: true };
    }

    const code = await this.emailCode.issue(dto.scene, email);
    try {
      await this.mail.sendCode(email, code);
    } catch (e) {
      // 发送失败回滚码与冷却，允许用户修正后立即重试
      await this.redis
        .del(`emailcode:${dto.scene}:${email}`, `emailcode:cool:${dto.scene}:${email}`)
        .catch(() => {});
      throw e;
    }
    this.log.record({ action: '发送邮箱验证码', target: email, ip, result: dto.scene });
    return { sent: true };
  }

  /**
   * 忘记密码重置（无需原密码）：reset 邮箱验证码校验（一次性 + 错 5 次销毁）→
   * 更新密码 + tokenVersion 自增——该用户全部已签发 access/refresh 令牌立即失效（全端下线），
   * 无需逐一清理 refresh 白名单（刷新时 ver 比对天然拒绝）。
   */
  async resetPassword(dto: ResetPasswordDto, ip?: string) {
    const email = dto.email.trim().toLowerCase();
    await this.emailCode.verify('reset', email, dto.code);
    const user = await this.prisma.user.findFirst({ where: { email, status: 'active' } });
    if (!user) throw new BadRequestException('该邮箱未绑定有效账号');
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(dto.newPassword),
        tokenVersion: { increment: 1 },
      },
    });
    this.log.record({
      action: '重置密码',
      target: user.username,
      userName: user.username,
      ip,
      result: '成功',
    });
    return null;
  }

  /**
   * 登录失败锁定（P1-2 账号级防爆破 / v0.9.48 阶梯锁定）：
   * 同一用户名 15 分钟窗口内累计失败 5 次触发锁定；连续触发锁定的次数越多锁得越久
   * （15min → 1h → 6h → 24h），封杀「每 15 分钟来试 5 个密码」的慢速爆破。
   * 锁定阶梯记忆（locktier）保留 24h，登录成功不清除（攻击者穿插成功账号也继续升级）。
   * P1-3 起计数下沉 Redis（重启不丢、多实例共享）；Redis 不可用时锁定检查 fail-open
   * （仍有 IP 限流兜底），不因锁组件故障导致全员无法登录。
   * 按用户名计数（不区分来源 IP）——防止单账号被分布式低频爆破；不存在的
   * 用户名同样计数，避免「探测账号是否存在」的旁路。
   * IP 级防密码喷洒（v0.9.48）：24h 内单 IP 登录失败 ≥ IP_FAIL_LIMIT 次 → 该 IP
   * 锁登录 1 小时（一密码喷千号的攻击每号只试 1 次不触发账号锁定，靠本机制拦截）。
   */
  private static readonly MAX_LOGIN_FAILS = 5;
  private static readonly LOCK_WINDOW_SEC = 15 * 60;
  /** 阶梯锁定时长（秒）：第 1/2/3/4+ 次被锁 → 15min / 1h / 6h / 24h */
  private static readonly LOCK_TIERS_SEC = [15 * 60, 3600, 6 * 3600, 24 * 3600];
  private static readonly LOCK_TIER_TTL_SEC = 24 * 3600;
  private static readonly IP_FAIL_LIMIT = 50;
  private static readonly IP_FAIL_WINDOW_SEC = 24 * 3600;
  private static readonly IP_BLOCK_SEC = 3600;
  /** refresh token 有效期 7 天（轮换制：每次刷新旧令牌立即作废） */
  private static readonly REFRESH_TTL_SEC = 7 * 24 * 3600;
  private failKey(username: string) {
    return `login:fail:${username}`;
  }
  private lockKey(username: string) {
    return `login:lock:${username}`;
  }
  private lockTierKey(username: string) {
    return `login:locktier:${username}`;
  }
  private ipFailKey(ip: string) {
    return `login:ipfail:${ip}`;
  }
  private ipBlockKey(ip: string) {
    return `login:ipblock:${ip}`;
  }

  /** 阶梯时长文案：秒 → 「15 分钟 / 1 小时 / 6 小时 / 24 小时」 */
  private static lockDurationText(sec: number) {
    return sec >= 3600 ? `${Math.round(sec / 3600)} 小时` : `${Math.round(sec / 60)} 分钟`;
  }

  /**
   * v0.9.57 时序侧信道防御：用户不存在时原实现直接 return null（省去 bcrypt ~100ms），
   * 「用户不存在」与「密码错误」的响应时差可被用来枚举有效用户名。
   * 对不存在账号跑一次等价 bcrypt 比对（固定假哈希），抹平时差。
   * v0.9.58：假哈希与渐进重哈希同为 cost 12——否则升级后用户（12）与幽灵（10）
   * 之间会出现新的 ~150ms 时差，侧信道换向复活。
   */
  private static readonly DUMMY_HASH =
    '$2b$12$ZuBqHhM/W6frrxDjMHJslefT7ArLgUM.I1XriWixMMf9V./o0Heo2';

  async validateUser(username: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user || user.status !== 'active') {
      await bcrypt.compare(password, AuthService.DUMMY_HASH).catch(() => {});
      return null;
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    return ok ? user : null;
  }

  async login(dto: LoginDto, ip?: string) {
    // 用户名 trim：首尾空格输入必查无此人且白耗一次失败计数；
    // 锁定/失败计数键统一小写归一——否则攻击者用 Admin/ADMIN/ a d m i n 变体
    // 各自独立计数，永远打不满真实账号的锁定阈值（变体绕过）
    const username = dto.username.trim();
    const lockName = username.toLowerCase();

    // IP 级喷洒封锁检查（B3）：优先于账号级（攻击者换账号也不放过）
    if (ip) {
      let ipBlocked: string | null = null;
      try {
        ipBlocked = await this.redis.get(this.ipBlockKey(ip));
      } catch {
        // fail-open：同账号级
      }
      if (ipBlocked) {
        throw new HttpException('该来源登录失败过于频繁，已被暂时限制，请 1 小时后再试', 429);
      }
    }

    // 账号级锁定检查（B2 阶梯时长）
    let lockTtl = 0;
    try {
      lockTtl = (await this.redis.ttl(this.lockKey(lockName))) || 0;
    } catch {
      // fail-open：Redis 故障不阻塞登录，仍有 IP 限流兜底
    }
    if (lockTtl > 0) {
      throw new HttpException(
        `登录失败次数过多，账号已被锁定，请约 ${AuthService.lockDurationText(lockTtl)}后再试`,
        429
      );
    }

    const user = await this.validateUser(username, dto.password);
    if (!user) {
      try {
        const fails = await this.redis.incr(this.failKey(lockName));
        if (fails === 1) {
          await this.redis.expire(this.failKey(lockName), AuthService.LOCK_WINDOW_SEC);
        }
        if (fails >= AuthService.MAX_LOGIN_FAILS) {
          // 阶梯升级：连续第 N 次被锁 → LOCK_TIERS[N-1]（封顶 24h）
          const tier = await this.redis.incr(this.lockTierKey(lockName));
          await this.redis.expire(this.lockTierKey(lockName), AuthService.LOCK_TIER_TTL_SEC);
          const tierIdx = Math.min(tier - 1, AuthService.LOCK_TIERS_SEC.length - 1);
          const duration = AuthService.LOCK_TIERS_SEC[tierIdx];
          await this.redis.set(this.lockKey(lockName), '1', 'EX', duration);
          // 锁已生效，失败计数清零，解锁后重新起算
          await this.redis.del(this.failKey(lockName));
          // 仅在触发锁定时落审计日志（避免每次失败都写库放大攻击面）
          this.log
            .record({
              action: '登录失败锁定',
              target: username,
              userName: username,
              ip,
              result: `15 分钟窗口内累计失败 ${fails} 次，第 ${tier} 次触发锁定 ${AuthService.lockDurationText(duration)}`,
            })
            .catch(() => {});
        }

        // IP 级喷洒计数（B3）：24h 滑动窗口内累计失败达阈值 → 该 IP 锁 1h
        if (ip) {
          const ipFails = await this.redis.incr(this.ipFailKey(ip));
          if (ipFails === 1) {
            await this.redis.expire(this.ipFailKey(ip), AuthService.IP_FAIL_WINDOW_SEC);
          }
          if (ipFails >= AuthService.IP_FAIL_LIMIT) {
            await this.redis.set(this.ipBlockKey(ip), '1', 'EX', AuthService.IP_BLOCK_SEC);
            this.log
              .record({
                action: 'IP 登录限制',
                target: ip,
                ip,
                result: `24 小时内登录失败 ${ipFails} 次，限制登录 1 小时`,
              })
              .catch(() => {});
          }
        }
      } catch {
        // fail-open：同上
      }
      // 提示语保持与「用户不存在」一致，防用户名枚举
      throw new UnauthorizedException('用户名或密码不正确');
    }

    // 登录成功清空该账号的失败计数与当前锁（locktier 阶梯记忆保留 24h，慢速爆破继续升级）
    await this.redis
      .del(this.failKey(lockName), this.lockKey(lockName))
      .catch(() => {});
    // 渐进重哈希（v0.9.58）：存量 cost 10 哈希在登录成功时自动升级到 12，
    // 用户无感；失败不阻塞登录（下次登录再试）
    const upgraded = rehashIfNeeded(user.passwordHash, dto.password);
    if (upgraded) {
      const newHash = await upgraded;
      await this.prisma.user
        .update({ where: { id: user.id }, data: { passwordHash: newHash } })
        .catch(() => {});
    }
    await this.prisma.user
      .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
      .catch(() => {}); // 登录时间记录失败不应导致登录本身失败
    return this.issueSession(user);
  }

  /** 签发会话（login/refresh/register 共用）：access + 轮换 refresh + 安全档案 */
  private async issueSession(user: Prisma.UserGetPayload<{}>) {
    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      ver: user.tokenVersion,
    };
    const token = await this.jwt.signAsync(payload);
    const refreshToken = await this.issueRefreshToken(user.id, user.tokenVersion);
    return { token, refreshToken, user: await this.toProfile(user) };
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

  /** GET+DEL 原子化（Lua）：先 get 再 del 的两步在并发下可被双花（两个请求都读到同一白名单值、
   * 各换得一对新令牌）；脚本保证「取到即删」，同一 refresh token 并发第二发必落空 */
  private static readonly GETDEL_LUA =
    'local v = redis.call("GET", KEYS[1]) if v then redis.call("DEL", KEYS[1]) end return v';

  /** 轮换宽限期（v0.9.65）：旧 refresh token 轮换后保留 60s 宽限 key。
   * 场景：用户开多个标签页（共享 localStorage），access token 同刻过期，各标签页
   * 独立发起 refresh——严格 GETDEL 下后到的标签页必 401 并被强制登出（还顺手清掉
   * localStorage 里别页刚换的新令牌，导致全端登出）。60s 窗口内旧令牌可再换一次，
   * 重放风险收敛到分钟级（改密/登出仍即时全废）。 */
  private static readonly GRACE_TTL_SEC = 60;

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
    const graceKey = `login:rt:grace:${payload.jti}`;
    let stored: string | null = null;
    let graceHit = false;
    try {
      stored = (await this.redis.eval(
        AuthService.GETDEL_LUA,
        1,
        key
      )) as string | null;
      if (!stored) {
        // 主白名单落空（已被其他标签页轮换）→ 查 60s 宽限 key
        graceHit = (await this.redis.get(graceKey)) === payload.sub;
        if (graceHit) stored = payload.sub;
      } else {
        // 正常轮换：给刚作废的旧令牌留 60s 宽限，吸收多标签并发刷新
        await this.redis
          .set(graceKey, payload.sub, 'EX', AuthService.GRACE_TTL_SEC)
          .catch(() => {});
      }
    } catch {
      // Redis 故障 fail-closed
    }
    if (stored !== payload.sub) {
      // 不存在 = 已轮换且超出宽限/已吊销/Redis 不可用；重放旧令牌同样在此被拒
      throw new UnauthorizedException('刷新令牌已失效，请重新登录');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('账号不存在或已停用');
    }
    // 改密/封禁会自增 tokenVersion：旧 refresh 即使还在白名单窗口内也一并拒绝
    if ((payload.ver ?? 0) !== user.tokenVersion) {
      // 宽限 key 也一并清除：全端下线不留残余窗口
      await this.redis.del(graceKey).catch(() => {});
      throw new UnauthorizedException('刷新令牌已失效，请重新登录');
    }
    return this.issueSession(user);
  }

  /** 登出吊销 refresh token（access token 仍存活至自然过期，≤2h 风险窗口） */
  async logout(refreshToken?: string) {
    if (!refreshToken) return null;
    try {
      const payload = await this.jwt.verifyAsync(refreshToken);
      if (payload?.type === 'refresh' && payload.jti) {
        // 宽限 key 一并吊销：登出后旧令牌无任何残留窗口
        await this.redis
          .del(`login:rt:${payload.jti}`, `login:rt:grace:${payload.jti}`)
          .catch(() => {});
      }
    } catch {
      // 令牌本身无效则无需吊销
    }
    return null;
  }

  /** 去掉密码字段，返回安全的用户对象（含 roleName，roles 表配置优先，缺失降级硬编码映射） */
  async toProfile(user: Prisma.UserGetPayload<{}>) {
    const { passwordHash, ...rest } = user;
    const role = await this.prisma.role.findUnique({
      where: { code: rest.role },
      select: { name: true },
    });
    return { ...rest, roleName: role?.name ?? ROLE_NAME[rest.role] ?? rest.role ?? '未知' };
  }
}
