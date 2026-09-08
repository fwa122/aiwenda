import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * 角色标记：@Roles('admin')
 * 由 RolesGuard 校验，需与 JwtAuthGuard 一起使用（先鉴权再验角色）
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
