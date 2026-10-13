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

// 环境变量硬赋值隔离测试库（与 auth/chat e2e 相同：独立库 6381，绝不触碰开发/生产库）
process.env.DATABASE_URL = 'postgresql://kbt:kbt@127.0.0.1:6381/kbt';
process.env.REDIS_URL = 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET = 'e2e-test-secret-0123456789abcdef0123456789abcdef';
process.env.JWT_EXPIRES_IN = '2h';
// MinIO 测试实例（独立桶名，避免与并行运行的其它 e2e 文件建桶/读写互相干扰）
process.env.MINIO_ENDPOINT = '127.0.0.1:6390';
process.env.MINIO_ACCESS_KEY = 'kbt';
process.env.MINIO_SECRET_KEY = 'kbt-minio';
process.env.MINIO_BUCKET = 'kb-test-stats';

const RUN = Date.now().toString(36);
const PASSWORD = 'Abcd1234';
const USER_VIEWER = `e2e_stats_v_${RUN}`; // 数据归属者（viewer，验证 403 + 聚合归属）
const USER_ADMIN = `e2e_stats_a_${RUN}`; // 管理员（验证 200）
// 唯一模型名：并行文件（chat.e2e 也写 messages）不会撞同一聚合分组，可对计数做精确断言
const UNIQUE_MODEL = `e2e-model-${RUN}`;
const CONV_ID = `conv_stats_${RUN}`;

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

  const viewerId = `e2euser_${USER_VIEWER}`;
  const adminId = `e2euser_${USER_ADMIN}`;
  await prisma.user.create({
    data: {
      id: viewerId,
      username: USER_VIEWER,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      nickname: '统计viewer',
      role: 'viewer',
      department: '研发部',
      status: 'active',
    },
  });
  await prisma.user.create({
    data: {
      id: adminId,
      username: USER_ADMIN,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      nickname: '统计admin',
      role: 'admin',
      department: '管理部',
      status: 'active',
    },
  });

  // 种子数据：1 会话 + 1 提问 + 2 条带 meta 的回答（一赞一踩）
  await prisma.conversation.create({
    data: { id: CONV_ID, userId: viewerId, title: '统计测试会话', kbIds: [] },
  });
  await prisma.message.create({
    data: { id: `msg_s_q_${RUN}`, conversationId: CONV_ID, role: 'user', content: '知识库迁移方案是什么？' },
  });
  await prisma.message.create({
    data: {
      id: `msg_s_a1_${RUN}`,
      conversationId: CONV_ID,
      role: 'assistant',
      content: '方案 A：停机迁移（点赞样例）',
      status: 'done',
      meta: { model: UNIQUE_MODEL, elapsedMs: 1000, tokens: { prompt: 900, completion: 300, total: 1200 } },
      feedback: 'like',
    },
  });
  await prisma.message.create({
    data: {
      id: `msg_s_a2_${RUN}`,
      conversationId: CONV_ID,
      role: 'assistant',
      content: '方案 B：双写迁移（差评样例）',
      status: 'done',
      meta: { model: UNIQUE_MODEL, elapsedMs: 3000, tokens: { prompt: 100, completion: 100, total: 200 } },
      feedback: 'dislike',
    },
  });
  // daily_stats 日粒度行（date 唯一，upsert 兼容并行文件已写入今日行的场景）
  await prisma.dailyStat.upsert({
    where: { date: new Date(new Date().toISOString().slice(0, 10)) },
    create: { date: new Date(), questions: 1, hitCount: 1, avgLatency: 2000, tokens: BigInt(1400) },
    update: {},
  });

  viewerToken = await login(USER_VIEWER);
  adminToken = await login(USER_ADMIN);
});

afterAll(async () => {
  // 只清自己的数据（并行文件共享同一测试库）：会话级联删除消息，用户按前缀删
  await prisma.conversation.deleteMany({ where: { id: CONV_ID } }).catch(() => {});
  await prisma.user
    .deleteMany({ where: { username: { startsWith: 'e2e_stats_' } } })
    .catch(() => {});
  await redis.flushdb().catch(() => {});
  await redis.quit().catch(() => {});
  await app.close();
});

describe('GET /api/v1/stats/cost（成本分析，仅 admin）', () => {
  it('未携带令牌返回 401', async () => {
    const res = await probe('GET', '/api/v1/stats/cost');
    expect(res.status).toBe(401);
  });

  it('viewer 角色被 RolesGuard 拒绝返回 403', async () => {
    const res = await probe('GET', '/api/v1/stats/cost', { token: viewerToken });
    expect(res.status).toBe(403);
  });

  it('admin 返回按模型/按用户/日趋势聚合，唯一模型计数精确', async () => {
    const res = await probe('GET', '/api/v1/stats/cost', { token: adminToken });
    expect(res.status).toBe(200);

    const row = res.body.data.byModel.find((r: any) => r.model === UNIQUE_MODEL);
    expect(row).toBeTruthy();
    expect(row.count).toBe(2);
    expect(row.tokens).toBe(1400);
    expect(row.promptTokens).toBe(1000);
    expect(row.completionTokens).toBe(400);
    expect(row.avgLatency).toBe(2000); // (1000 + 3000) / 2

    const user = res.body.data.byUser.find((r: any) => r.username === USER_VIEWER);
    expect(user).toBeTruthy();
    expect(user.questions).toBe(2);
    expect(user.tokens).toBe(1400);
    expect(user.department).toBe('研发部'); // byUser 携带部门，供看板与报表展示

    // 部门维度聚合：成本分摊到部门，未设置部门归入「未设置」
    const dept = res.body.data.byDept.find((r: any) => r.department === '研发部');
    expect(dept).toBeTruthy();
    expect(dept.users).toBe(1);
    expect(dept.questions).toBe(2);
    expect(dept.tokens).toBe(1400);

    const today = new Date().toISOString().slice(5, 10).replace('-', '-');
    const trendRow = res.body.data.trend.find((r: any) => r.date === today);
    expect(trendRow).toBeTruthy(); // daily_stats 今日行在趋势中

    expect(res.body.data.total.tokens).toBeGreaterThanOrEqual(1400);
    expect(res.body.data.days).toBe(30); // 缺省 days
  });

  it('days 越界收敛到安全区间（99999 → 365），非法值回落 30', async () => {
    const big = await probe('GET', '/api/v1/stats/cost?days=99999', { token: adminToken });
    expect(big.status).toBe(200);
    expect(big.body.data.days).toBe(365);

    const bad = await probe('GET', '/api/v1/stats/cost?days=abc', { token: adminToken });
    expect(bad.status).toBe(200);
    expect(bad.body.data.days).toBe(30);
  });
});

describe('GET /api/v1/stats/feedback（评价分析，仅 admin）', () => {
  it('未携带令牌返回 401，viewer 返回 403', async () => {
    expect((await probe('GET', '/api/v1/stats/feedback')).status).toBe(401);
    expect((await probe('GET', '/api/v1/stats/feedback', { token: viewerToken })).status).toBe(403);
  });

  it('admin 返回汇总/趋势/差评明细，差评关联到原始提问', async () => {
    const res = await probe('GET', '/api/v1/stats/feedback', { token: adminToken });
    expect(res.status).toBe(200);

    // 点赞/点踩仅种子数据携带（并行文件的消息 feedback 为 null，不影响精确计数）
    expect(res.body.data.summary.likes).toBe(1);
    expect(res.body.data.summary.dislikes).toBe(1);
    expect(res.body.data.summary.satisfaction).toBe(0.5);
    expect(res.body.data.summary.ratedRate).toBeGreaterThan(0);

    const today = new Date().toISOString().slice(5, 10).replace('-', '-');
    const trendRow = res.body.data.trend.find((r: any) => r.date === today);
    expect(trendRow).toBeTruthy();
    expect(trendRow.likes).toBe(1);
    expect(trendRow.dislikes).toBe(1);

    // 差评明细：最新差评是我们种的 a2，question 取同会话最近一条 user 消息
    const disliked = res.body.data.disliked as Array<Record<string, any>>;
    const mine = disliked.find((r) => r.id === `msg_s_a2_${RUN}`);
    expect(mine).toBeTruthy();
    expect(mine.conversationId).toBe(CONV_ID);
    expect(mine.question).toBe('知识库迁移方案是什么？');
    expect(mine.answer).toContain('方案 B');
  });
});
