import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResult<T> {
  code: number;
  message: string;
  data: T;
}

/**
 * 把任意值里的 BigInt 转成 Number / String，避免 JSON 序列化报错
 * （Prisma 的 bigint 字段会以 BigInt 形式返回，JSON.stringify 不支持）
 */
function serializeBigInt(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) &&
      value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof Buffer !== 'undefined' && value instanceof Buffer) {
    return value.toString('base64');
  }
  if (Array.isArray(value)) {
    return value.map(serializeBigInt);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = serializeBigInt(v);
    }
    return out;
  }
  return value;
}

/**
 * 统一响应包装：所有 controller 的返回值都会被包成 { code: 0, message: 'ok', data }
 * 与前端接口约定一致
 */
@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiResult<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler
  ): Observable<ApiResult<T>> {
    return next.handle().pipe(
      map((data) => ({
        code: 0,
        message: 'ok',
        data: serializeBigInt(data === undefined ? null : data) as T,
      }))
    );
  }
}
