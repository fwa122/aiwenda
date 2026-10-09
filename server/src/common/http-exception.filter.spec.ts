import { describe, expect, it, vi } from 'vitest';
import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { HttpExceptionFilter } from './http-exception.filter';

function makeHost(res: unknown): ArgumentsHost {
  return { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
}

/** 捕获一次异常并返回过滤器写入的响应 */
function catchIt(exception: unknown) {
  const json = vi.fn();
  const status = vi.fn((...args: unknown[]) => ({ json }));
  const res: any = { headersSent: false, status };
  new HttpExceptionFilter().catch(exception, makeHost(res));
  return { statusCode: status.mock.calls[0][0], body: json.mock.calls[0][0] };
}

describe('HttpExceptionFilter（统一异常响应）', () => {
  it('ThrottlerException 的英文默认文案替换为友好中文，code 跟随 429', () => {
    const { statusCode, body } = catchIt(new ThrottlerException());
    expect(statusCode).toBe(429);
    expect(body).toEqual({ code: 429, message: '操作过于频繁，请稍后再试', data: null });
  });

  it('业务自定义 429（登录锁定文案）原样透传，不被覆盖', () => {
    const { statusCode, body } = catchIt(
      new HttpException({ message: '登录失败次数过多，账号已暂时锁定', code: 429 }, 429)
    );
    expect(statusCode).toBe(429);
    expect(body.message).toBe('登录失败次数过多，账号已暂时锁定');
  });

  it('对象形式响应：code 以 body.code 为准，message 取 body.message', () => {
    const { statusCode, body } = catchIt(
      new HttpException({ message: '参数错误', code: 1001 }, HttpStatus.BAD_REQUEST)
    );
    expect(statusCode).toBe(400);
    expect(body).toEqual({ code: 1001, message: '参数错误', data: null });
  });

  it('class-validator 的错误数组 join 为字符串', () => {
    const { body } = catchIt(
      new HttpException({ message: ['用户名必填', '密码必填'] }, HttpStatus.BAD_REQUEST)
    );
    expect(body.message).toBe('用户名必填；密码必填');
  });

  it('非 HttpException 归一为 500 与默认文案', () => {
    const { statusCode, body } = catchIt(new Error('boom'));
    expect(statusCode).toBe(500);
    expect(body).toEqual({ code: 500, message: '服务器内部错误', data: null });
  });

  it('SSE 响应已开始（headersSent）时不再写 JSON，避免 ERR_HTTP_HEADERS_SENT', () => {
    const statusFn = vi.fn();
    const res: any = { headersSent: true, status: statusFn };
    new HttpExceptionFilter().catch(new Error('late'), makeHost(res));
    expect(statusFn).not.toHaveBeenCalled();
  });
});
