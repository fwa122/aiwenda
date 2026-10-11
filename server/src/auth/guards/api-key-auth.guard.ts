import { createHash } from 'crypto';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../../prisma/prisma.service';

/** API 密钥前缀：请求头 Bearer 后以此开头即走密钥认证，其余走 JWT */
export const API_KEY_PREFIX = 'sk-kb-';

/** 认证主体：JWT 与 API 密钥共用 req.user 契约，密钥额外携带 scope 供业务收敛检索范围 */
export interface RequestUser {
  id: string;
  username: string;
  role: string;
  /** API 密钥调用的授权知识库集合；JWT 登录时为 undefined */
  apiKeyScope?: string[];
  /** 命中的密钥 id（审计用） */
  apiKeyId?: string;
}

/**
 * 复合认证守卫：JWT 与 API 密钥双通道。
 * - JWT：与 JwtAuthGuard 行为完全一致（super 透传，存量接口零影响）；
 * - sk-kb-* 前缀：走 API 密钥认证（哈希等值查库 → 状态/过期/归属/每日配额校验）。
 *
 * 仅挂在对外问答端点（chat 模块）上——密钥不开放用户/知识库管理等后台接口。
 */
@Injectable()
export class ApiKeyAuthGuard extends AuthGuard('jwt') implements CanActivate {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = this.extractBearer(req);
    if (token?.startsWith(API_KEY_PREFIX)) {
      req.user = await this.authenticateApiKey(token);
      return true;
    }
    // 非密钥：透传 JWT 校验（签名/过期/tokenVersion/账号状态）
    return (await super.canActivate(context)) as boolean;
  }

  private extractBearer(req: any): string | null {
    const header: string = req?.headers?.authorization || '';
    return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  }

  /**
   * API 密钥认证。sha256 对比库内哈希（明文从不落库）：
   * - 无效/停用/过期/归属账号不可用 → 401；
   * - scope 为空（UI 语义「未授权」）→ 403，防止「建了钥就能全库问答」的默认放行；
   * - 每日配额：跨日惰性重置（以 UTC 日为界，无需定时任务），超限 429；
   * - 通过后自增 usedToday 并记录 lastUsedAt（设置页「今日用量/最近调用」展示）。
   */
  async authenticateApiKey(token: string): Promise<RequestUser> {
    const keyHash = createHash('sha256').update(token).digest('hex');
    const row = await this.prisma.apiKey.findUnique({ where: { keyHash } });
    if (!row) throw new UnauthorizedException('无效的 API 密钥');
    if (row.status !== 'active') throw new UnauthorizedException('API 密钥已停用');
    if (row.expiredAt && row.expiredAt.getTime() < Date.now()) {
      throw new UnauthorizedException('API 密钥已过期');
    }

    const scope = Array.isArray(row.scope) ? (row.scope as string[]) : [];
    if (!scope.length) {
      throw new ForbiddenException('该密钥未授权任何知识库，请在设置页配置授权范围');
    }

    const owner = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: { id: true, username: true, role: true, status: true },
    });
    if (!owner || owner.status !== 'active') {
      throw new UnauthorizedException('密钥所属账号不可用');
    }

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const lastDay = row.lastUsedAt ? row.lastUsedAt.toISOString().slice(0, 10) : null;
    const used = lastDay === today ? row.usedToday : 0;
    if (used >= row.quotaPerDay) {
      throw new HttpException(`今日调用配额已用尽（${row.quotaPerDay}），明日自动重置`, 429);
    }
    await this.prisma.apiKey.update({
      where: { id: row.id },
      data: {
        usedToday: lastDay === today ? { increment: 1 } : 1,
        lastUsedAt: now,
      },
    });

    return { id: owner.id, username: owner.username, role: owner.role, apiKeyScope: scope, apiKeyId: row.id };
  }
}
