import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/redis/redis.module';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { AiServiceClient } from '../src/integrations/ai-service.client';
import type Redis from 'ioredis';

// 环境变量硬赋值隔离测试库（独立库 6381/6380，绝不触碰开发/生产库）
process.env.DATABASE_URL = 'postgresql://kbt:kbt@127.0.0.1:6381/kbt';
process.env.REDIS_URL = 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET = 'e2e-test-secret-0123456789abcdef0123456789abcdef';
process.env.JWT_EXPIRES_IN = '2h';
process.env.MINIO_ENDPOINT = '127.0.0.1:6390';
process.env.MINIO_ACCESS_KEY = 'kbt';
process.env.MINIO_SECRET_KEY = 'kbt-minio';
process.env.MINIO_BUCKET = 'kb-test-settings';

const RUN = Date.now().toString(36);
const PASSWORD = 'Abcd1234';
const USER_VIEWER = `e2e_set_v_${RUN}`; // 普通用户（验证 summary 可读 + probe 403）
const USER_ADMIN = `e2e_set_a_${RUN}`; // 管理员（验证 probe 转发）

let app: INestApplication;
let prisma: PrismaService;
let redis: Redis;
let baseUrl: string;
let viewerToken: string;
let adminToken: string;

interface ProbeResult {
  status: number;
  body: any;
}

/** 原生 fetch 探测（supertest 在本机存在 ESM interop 缺陷，弃用） */
function probe(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  opts: { token?: string; body?: unknown } = {}
): Promise<ProbeResult> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  return fetch(baseUrl + path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  }).then(async (res) => ({
    status: res.status,
    body: await res.json().catch(() => null),
  }));
}

async function login(username: string): Promise<string> {
  const res = await probe('POST', '/api/v1/auth/login', {
    body: { username, password: PASSWORD },
  });
  expect(res.status).toBe(201);
  return res.body.data.token as string;
}

beforeAll(async () => {
  // AiServiceClient 打桩：e2e 不依赖真实 ai-service 进程，仅验证 BFF 权限与转发形状
  const aiStub = {
    embeddingState: async () => ({
      signature: { provider: 'zhipu', model: 'embedding-3', dimensions: 1024 },
      config: { provider: 'zhipu', model: 'embedding-3', dimensions: 1024 },
      needsReembed: false,
      phase: 'idle',
      health: { status: 'ok', lastOkAt: null, lastErrorAt: null, lastErrorKind: null, lastErrorMsg: null, userMessage: null },
      progress: null,
      preview: { docCount: 0, chunkCount: 0, estimatedTokens: 0 },
    }),
    probeEmbedding: async () => ({
      ok: true,
      kind: null,
      userMessage: null,
      latencyMs: 12,
      checkedAt: new Date().toISOString(),
    }),
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AiServiceClient)
    .useValue(aiStub)
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpAdapter().getHttpServer().address() as { port: number }).port;
  baseUrl = `http://127.0.0.1:${port}`;

  prisma = app.get(PrismaService);
  redis = app.get<Redis>(REDIS_CLIENT);

  await prisma.user.create({
    data: {
      id: `e2euser_${USER_VIEWER}`,
      username: USER_VIEWER,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      nickname: '设置viewer',
      role: 'viewer',
      department: '研发部',
      status: 'active',
    },
  });
  await prisma.user.create({
    data: {
      id: `e2euser_${USER_ADMIN}`,
      username: USER_ADMIN,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      nickname: '设置admin',
      role: 'admin',
      department: '管理部',
      status: 'active',
    },
  });

  viewerToken = await login(USER_VIEWER);
  adminToken = await login(USER_ADMIN);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: { in: [USER_VIEWER, USER_ADMIN] } } });
  await app.close();
  await redis.quit();
});

describe('设置：嵌入渠道可用性（v0.9.42）', () => {
  it('普通用户可读可用性摘要（登录即可，无需 admin）', async () => {
    const res = await probe('GET', '/api/v1/settings/embedding/summary', { token: viewerToken });
    expect(res.status).toBe(200);
    // 摘要仅含 available/message，不泄露渠道名/密钥/内部错误细节
    expect(Object.keys(res.body.data).sort()).toEqual(['available', 'message']);
    // 测试库无 embedding_state 表 → 按可用兜底（软提示不阻塞）
    expect(res.body.data.available).toBe(true);
  });

  it('摘要未登录返回 401', async () => {
    const res = await probe('GET', '/api/v1/settings/embedding/summary');
    expect(res.status).toBe(401);
  });

  it('探测接口普通用户 403（admin 守卫先于控制器，不触发上游调用）', async () => {
    const res = await probe('POST', '/api/v1/settings/embedding/probe', { token: viewerToken });
    expect(res.status).toBe(403);
  });

  it('admin 探测转发上游结果（ok/latencyMs/checkedAt 形状）', async () => {
    const res = await probe('POST', '/api/v1/settings/embedding/probe', { token: adminToken });
    expect(res.status).toBe(200); // 控制器标注 @HttpCode(200)（与 verify-key 惯例一致）
    expect(res.body.data.ok).toBe(true);
    expect(typeof res.body.data.latencyMs).toBe('number');
    expect(res.body.data.checkedAt).toBeTruthy();
  });

  it('admin 嵌入状态读取透传 health 区块', async () => {
    const res = await probe('GET', '/api/v1/settings/embedding', { token: adminToken });
    expect(res.status).toBe(200);
    expect(res.body.data.health).toBeTruthy();
    expect(res.body.data.health.status).toBe('ok');
  });

  it('嵌入状态普通用户 403', async () => {
    const res = await probe('GET', '/api/v1/settings/embedding', { token: viewerToken });
    expect(res.status).toBe(403);
  });
});
