import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * 统一异常处理：把任意异常转成 { code, message, data: null }
 * code 默认用 HTTP 状态码；class-validator 的字段错误数组会被 join 成字符串
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    // SSE 流式响应已开始后不再写 JSON，避免 ERR_HTTP_HEADERS_SENT
    if (res.headersSent) {
      return;
    }

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = status;
    let message: unknown = '服务器内部错误';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r: any = exception.getResponse();
      if (typeof r === 'string') {
        message = r;
      } else if (r && typeof r === 'object') {
        message = r.message ?? exception.message;
        code = r.code ?? status;
      }
    }

    if (Array.isArray(message)) {
      message = (message as unknown[]).join('；');
    }

    res.status(status).json({
      code,
      message: typeof message === 'string' ? message : '服务器内部错误',
      data: null,
    });
  }
}
