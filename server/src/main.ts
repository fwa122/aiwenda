import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/response.interceptor';
import { HttpExceptionFilter } from './common/http-exception.filter';

/**
 * 进程级异常兜底（P0-A3）：未捕获异常/拒绝不再直接崩进程裸退，而是记录 ERROR
 * 后继续运行（配合容器 healthcheck + restart: unless-stopped 兜底真正不可恢复的
 * 状态）。避免单次未捕获异常导致全站瞬间 502。
 */
function registerProcessGuards() {
  process.on('uncaughtException', (e) => {
    console.error(`[uncaughtException] ${(e?.stack || e)?.toString()}`);
  });
  process.on('unhandledRejection', (reason) => {
    console.error(`[unhandledRejection] ${(reason as Error)?.stack || reason}`);
  });
}

/** JWT 密钥启动强校验（fail-fast：弱密钥拒绝启动，而非上生产后被告警忽略） */
function assertStrongJwtSecret() {
  const secret = process.env.JWT_SECRET || '';
  if (secret.length < 32 || secret === 'dev-secret-change-in-prod') {
    console.error('❌ JWT_SECRET 未配置或强度不足（要求 ≥32 字符且非默认值）');
    console.error('   生成强密钥：openssl rand -hex 32，并写入 server/.env 后重启');
    process.exit(1);
  }
}

async function bootstrap() {
  assertStrongJwtSecret();
  registerProcessGuards();

  const app = await NestFactory.create(AppModule);

  // 安全响应头（P1-B5）：X-Content-Type-Options / X-Frame-Options / HSTS 等。
  // CSP 关闭：本服务是纯 JSON API，页面 CSP 由前端 nginx 层负责，避免干扰调试。
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

  // 信任一层反代（nginx 已设置 X-Forwarded-For）：
  // 让 req.ip 取到真实客户端 IP，避免全局限流把所有用户算成同一个 127.0.0.1 桶
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // JSON body 放宽至 12MB：附件上传走 base64 JSON（5MB 文件 base64 后约 6.7MB）
  app.use(express.json({ limit: '12mb' }));

  // 全局路由前缀：与前端请求路径 /api/v1/* 对齐
  app.setGlobalPrefix('api/v1');

  // 全局 DTO 校验
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    })
  );

  // 统一响应 / 异常处理
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  // 跨域白名单（P1-B6）：origin 严格白名单（FRONTEND_URL 逗号分隔），永不放开 '*'。
  // 当前部署形态为 nginx 同域反代（前端/API 同源），CORS 实际不触发，白名单仅覆盖
  // 本地开发与拆域部署场景；若未来拆域，须把新前端域名加入 FRONTEND_URL，禁止图省事改 '*'。
  const origins = (process.env.FRONTEND_URL || 'http://localhost:5173,http://localhost:4173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: false });

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  console.log(`✅ Server running on http://localhost:${port}/api/v1`);
}

bootstrap();
