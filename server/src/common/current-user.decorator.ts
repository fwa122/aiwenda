import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * 从请求中取当前登录用户（由 JwtStrategy.validate 注入到 req.user）
 * 用法：@CurrentUser() user / @CurrentUser('id') id
 */
export const CurrentUser = createParamDecorator(
  (data: string, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    return data ? req.user?.[data] : req.user;
  }
);
