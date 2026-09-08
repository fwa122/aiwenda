import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/response.interceptor';
import { HttpExceptionFilter } from './common/http-exception.filter';

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

  const app = await NestFactory.create(AppModule);

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

  // 跨域白名单：FRONTEND_URL 支持逗号分隔多个来源；前端走 Authorization 头，不需要 cookie
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
