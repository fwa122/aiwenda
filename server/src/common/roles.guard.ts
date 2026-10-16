import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

/**
 * 角色守卫：读取 @Roles() 元数据，校验 req.user.role（角色 code 白名单）。
 * 必须放在 JwtAuthGuard 之后：@UseGuards(JwtAuthGuard, RolesGuard)
 * 配置化鉴权约定：
 * - 角色 code 的有效性由两处保证：jwt.strategy 每请求实时查 roles 表取 dataScope
 *   （角色被删则按 SELF 最小权限兜底，管理类服务层判断自然失效）；
 *   user.service create/update 校验角色存在性（逻辑外键）。
 * - 服务层数据权限一律用 common/rbac 的 hasAllScope(user)（dataScope=ALL 即超管），
 *   本守卫只做接口级的角色 code 白名单校验，不查库（dataScope 已随 req.user 注入）。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user?.role) throw new ForbiddenException('无权限访问');
    if (!required.includes(user.role)) {
      throw new ForbiddenException('该操作需要管理员权限');
    }
    return true;
  }
}
