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
import type Redis from 'ioredis';

// 环境变量硬赋值隔离测试库（与 auth/chat/stats e2e 相同：独立库 6381，绝不触碰开发/生产库）
process.env.DATABASE_URL = 'postgresql://kbt:kbt@127.0.0.1:6381/kbt';
process.env.REDIS_URL = 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET = 'e2e-test-secret-0123456789abcdef0123456789abcdef';
process.env.JWT_EXPIRES_IN = '2h';
process.env.MINIO_ENDPOINT = '127.0.0.1:6390';
process.env.MINIO_ACCESS_KEY = 'kbt';
process.env.MINIO_SECRET_KEY = 'kbt-minio';
process.env.MINIO_BUCKET = 'kb-test-evalcase';

const RUN = Date.now().toString(36);
const PASSWORD = 'Abcd1234';
const USER_OWNER = `e2e_eval_o_${RUN}`; // 知识库 owner（任意角色可写自己的库）
const USER_OTHER = `e2e_eval_v_${RUN}`; // 非 owner 普通用户（internal 可读，写 403）
const USER_ADMIN = `e2e_eval_a_${RUN}`; // 管理员（恒可写）
const KB_ID = `kb_eval_${RUN}`;

let app: INestApplication;
let prisma: PrismaService;
let redis: Redis;
let baseUrl: string;
let ownerToken: string;
let otherToken: string;
let adminToken: string;

interface ProbeResult {
  status: number;
  body: any;
}

/** 原生 fetch 探测（supertest 在本机存在 ESM interop 缺陷，弃用） */
function probe(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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

  const ownerId = `e2euser_${USER_OWNER}`;
  const otherId = `e2euser_${USER_OTHER}`;
  const adminId = `e2euser_${USER_ADMIN}`;
  const hash = await bcrypt.hash(PASSWORD, 10);
  await prisma.user.create({
    data: { id: ownerId, username: USER_OWNER, passwordHash: hash, nickname: '评测owner', role: 'viewer', department: '研发部', status: 'active' },
  });
  await prisma.user.create({
    data: { id: otherId, username: USER_OTHER, passwordHash: hash, nickname: '评测visitor', role: 'viewer', department: '运营部', status: 'active' },
  });
  await prisma.user.create({
    data: { id: adminId, username: USER_ADMIN, passwordHash: hash, nickname: '评测admin', role: 'admin', department: '管理部', status: 'active' },
  });

  await prisma.knowledgeBase.create({
    data: {
      id: KB_ID,
      name: `评测用例测试库_${RUN}`,
      status: 'ready',
      visibility: 'internal',
      owner: USER_OWNER,
      userId: ownerId,
      retrieverConfig: { topK: 5, threshold: 0.28, rerank: true, rerankModel: '', hybrid: true },
      llmConfig: { provider: 'qianwen', model: 'qwen3.8-max', temperature: 0.3 },
    },
  });

  ownerToken = await login(USER_OWNER);
  otherToken = await login(USER_OTHER);
  adminToken = await login(USER_ADMIN);
}, 60000);

afterAll(async () => {
  // 清理本 RUN 的数据（外键级联会带走 eval_cases）
  await prisma.knowledgeBase.deleteMany({ where: { id: KB_ID } });
  await prisma.user.deleteMany({
    where: { username: { in: [USER_OWNER, USER_OTHER, USER_ADMIN] } },
  });
  await app?.close();
  await redis?.quit();
});

describe('评测用例 CRUD（KnowledgeBase /eval-cases）', () => {
  it('未登录 401，登录后空列表 200', async () => {
    const anon = await probe('GET', `/api/v1/knowledge/${KB_ID}/eval-cases`);
    expect(anon.status).toBe(401);

    const res = await probe('GET', `/api/v1/knowledge/${KB_ID}/eval-cases`, { token: ownerToken });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ list: [], total: 0 });
  });

  it('owner 创建用例 201：字段持久化 + 生成 evc_ 前缀 id', async () => {
    const res = await probe('POST', `/api/v1/knowledge/${KB_ID}/eval-cases`, {
      token: ownerToken,
      body: {
        question: '检索时向量和关键词两路结果是怎么融合排序的？',
        docNameContains: '后端开发方案',
        keywords: ['RRF', 'k=60'],
        note: '6.8.1 RRF 融合重排',
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toMatch(/^evc_/);
    expect(res.body.data.source).toBe('manual');
    expect(res.body.data.isHard).toBe(false);
    expect(res.body.data.enabled).toBe(true);
    expect(res.body.data.keywords).toEqual(['RRF', 'k=60']);
  });

  it('重复问题 400，缺 question 400（校验层拦截）', async () => {
    const dup = await probe('POST', `/api/v1/knowledge/${KB_ID}/eval-cases`, {
      token: ownerToken,
      body: { question: '检索时向量和关键词两路结果是怎么融合排序的？', docNameContains: 'x', keywords: [] },
    });
    expect(dup.status).toBe(400);

    const invalid = await probe('POST', `/api/v1/knowledge/${KB_ID}/eval-cases`, {
      token: ownerToken,
      body: { docNameContains: 'x', keywords: [] },
    });
    expect(invalid.status).toBe(400);
  });

  it('owner 更新用例：isHard 标记 + 改成重复问题 400', async () => {
    const list = await probe('GET', `/api/v1/knowledge/${KB_ID}/eval-cases`, { token: ownerToken });
    const caseId = list.body.data.list[0].id as string;

    // 先建第二条用于改重校验
    await probe('POST', `/api/v1/knowledge/${KB_ID}/eval-cases`, {
      token: ownerToken,
      body: { question: '数据库一共设计了多少张表？', docNameContains: '后端开发方案', keywords: ['11 张表'] },
    });

    const mark = await probe('PUT', `/api/v1/knowledge/${KB_ID}/eval-cases/${caseId}`, {
      token: ownerToken,
      body: { isHard: true, note: '[难例证据] 精排开未命中' },
    });
    expect(mark.status).toBe(200);
    expect(mark.body.data.isHard).toBe(true);

    const toDup = await probe('PUT', `/api/v1/knowledge/${KB_ID}/eval-cases/${caseId}`, {
      token: ownerToken,
      body: { question: '数据库一共设计了多少张表？' },
    });
    expect(toDup.status).toBe(400);
  });

  it('批量导入：重复跳过 + hardcase 来源与 isHard 持久化', async () => {
    const res = await probe('POST', `/api/v1/knowledge/${KB_ID}/eval-cases/import`, {
      token: ownerToken,
      body: {
        cases: [
          {
            question: '数据库一共设计了多少张表？', // 与已有重复 → skipped
            docNameContains: '后端开发方案',
            keywords: ['11 张表'],
          },
          {
            question: '80 端口被占用了要怎么处理？',
            docNameContains: '启动运行指南',
            keywords: ['NGINX_PORT'],
            source: 'hardcase',
            isHard: true,
            note: '[回归证据] 精排关#0 精排开#0',
          },
        ],
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ created: 1, skipped: 1 });

    const list = await probe('GET', `/api/v1/knowledge/${KB_ID}/eval-cases`, { token: ownerToken });
    const imported = list.body.data.list.find((c: any) => c.question === '80 端口被占用了要怎么处理？');
    expect(imported.source).toBe('hardcase');
    expect(imported.isHard).toBe(true);
    // 排序：难例排在最后
    expect(list.body.data.list[list.body.data.list.length - 1].isHard).toBe(true);
  });

  it('非 owner 普通用户：读 200、写 403；admin 恒可写', async () => {
    const read = await probe('GET', `/api/v1/knowledge/${KB_ID}/eval-cases`, { token: otherToken });
    expect(read.status).toBe(200);

    const write = await probe('POST', `/api/v1/knowledge/${KB_ID}/eval-cases`, {
      token: otherToken,
      body: { question: '越权写入的用例', docNameContains: 'x', keywords: [] },
    });
    expect(write.status).toBe(403);

    const admin = await probe('POST', `/api/v1/knowledge/${KB_ID}/eval-cases`, {
      token: adminToken,
      body: { question: 'admin 建的用例', docNameContains: 'x', keywords: [] },
    });
    expect(admin.status).toBe(201);
  });

  it('删除用例 200，再删 404；未知知识库 404', async () => {
    const list = await probe('GET', `/api/v1/knowledge/${KB_ID}/eval-cases`, { token: ownerToken });
    const caseId = list.body.data.list[0].id as string;
    const before = list.body.data.total as number;

    const del = await probe('DELETE', `/api/v1/knowledge/${KB_ID}/eval-cases/${caseId}`, {
      token: ownerToken,
    });
    expect(del.status).toBe(200);
    expect(del.body.data.id).toBe(caseId);

    const again = await probe('DELETE', `/api/v1/knowledge/${KB_ID}/eval-cases/${caseId}`, {
      token: ownerToken,
    });
    expect(again.status).toBe(404);

    const after = await probe('GET', `/api/v1/knowledge/${KB_ID}/eval-cases`, { token: ownerToken });
    expect(after.body.data.total).toBe(before - 1);

    const missing = await probe('GET', `/api/v1/knowledge/kb_not_exists_${RUN}/eval-cases`, {
      token: ownerToken,
    });
    expect(missing.status).toBe(404);
  });
});
