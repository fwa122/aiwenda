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
// v0.9.39：引用来源种子（差证明细反查 sourceDocs/refKb）与回流用例目标库
const KB_ID = `kb_stats_${RUN}`;
const DOC_ID = `doc_stats_${RUN}`;
const DOC_NAME = `统计测试文档_${RUN}.md`;

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
  // v0.9.40：语义缓存命中样例（cacheHit=true 的 tokens 是重放值，计费口径应被排除）
  await prisma.message.create({
    data: {
      id: `msg_s_a3_${RUN}`,
      conversationId: CONV_ID,
      role: 'assistant',
      content: '方案 A（缓存重放样例）',
      status: 'done',
      meta: {
        model: UNIQUE_MODEL,
        elapsedMs: 5,
        tokens: { prompt: 200, completion: 100, total: 300 },
        cacheHit: true,
      },
    },
  });
  // daily_stats 日粒度行（date 唯一，upsert 兼容并行文件已写入今日行的场景）
  await prisma.dailyStat.upsert({
    where: { date: new Date(new Date().toISOString().slice(0, 10)) },
    create: { date: new Date(), questions: 1, hitCount: 1, avgLatency: 2000, tokens: BigInt(1400) },
    update: {},
  });

  // v0.9.39：引用来源链路种子（库/文档/坐标），差评 a2 挂 1 条引用
  await prisma.knowledgeBase.create({
    data: {
      id: KB_ID,
      name: `统计测试库_${RUN}`,
      userId: adminId,
      status: 'ready',
      retrieverConfig: {},
      llmConfig: {},
    },
  });
  await prisma.document.create({
    data: { id: DOC_ID, kbId: KB_ID, name: DOC_NAME, type: 'md' },
  });
  await prisma.messageSource.create({
    data: {
      messageId: `msg_s_a2_${RUN}`,
      kbId: KB_ID,
      docId: DOC_ID,
      chunkId: `ck_stats_${RUN}`,
      chunkIndex: 0,
      page: 1,
      score: 0.9,
      sortOrder: 0,
    },
  });

  viewerToken = await login(USER_VIEWER);
  adminToken = await login(USER_ADMIN);
});

afterAll(async () => {
  // 只清自己的数据（并行文件共享同一测试库）：会话级联删除消息与引用坐标，
  // 库级联删除文档/评测用例，用户按前缀删
  await prisma.conversation.deleteMany({ where: { id: CONV_ID } }).catch(() => {});
  await prisma.knowledgeBase.deleteMany({ where: { id: KB_ID } }).catch(() => {});
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
    // v0.9.40：种子 a3（cacheHit=true, total=300）不计入计费聚合，
    // count/tokens 保持 2/1400 即验证缓存命中消息已被 SQL 排除
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

  it('v0.9.40 cacheSaved：缓存命中单独聚合（hits/tokens 下界断言，兼容并行文件的额外命中样本）', async () => {
    const res = await probe('GET', '/api/v1/stats/cost', { token: adminToken });
    expect(res.status).toBe(200);

    // a3 种子（cacheHit=true, total=300）必须出现在 cacheSaved；chat.e2e 并行运行
    // 时其 CACHE_HIT_ 样例（600 tokens）也会贡献，故用下界而非精确值
    expect(res.body.data.cacheSaved.hits).toBeGreaterThanOrEqual(1);
    expect(res.body.data.cacheSaved.tokens).toBeGreaterThanOrEqual(300);
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

describe('v0.9.39 消息反馈闭环（点踩原因标注 + 差评回流）', () => {
  it('带 reason/note 点踩落库', async () => {
    const res = await probe('POST', `/api/v1/messages/msg_s_a1_${RUN}/feedback`, {
      token: viewerToken,
      body: { type: 'dislike', reason: 'offtopic', note: '答非所问样例' },
    });
    expect(res.status).toBe(201);

    const row = await prisma.message.findUnique({ where: { id: `msg_s_a1_${RUN}` } });
    expect(row.feedback).toBe('dislike');
    expect(row.feedbackReason).toBe('offtopic');
    expect(row.feedbackNote).toBe('答非所问样例');
  });

  it('差证明细携带原因/差评人/引用文档/首引用库，回流前 reflowed=false', async () => {
    // a2 补一个带原因的点踩（种子直接落库无 reason）
    const set = await probe('POST', `/api/v1/messages/msg_s_a2_${RUN}/feedback`, {
      token: viewerToken,
      body: { type: 'dislike', reason: 'citation', note: '引用错了' },
    });
    expect(set.status).toBe(201);

    const res = await probe('GET', '/api/v1/stats/feedback', { token: adminToken });
    expect(res.status).toBe(200);
    const mine = (res.body.data.disliked as Array<Record<string, any>>).find(
      (r) => r.id === `msg_s_a2_${RUN}`
    );
    expect(mine).toBeTruthy();
    expect(mine.reason).toBe('citation');
    expect(mine.note).toBe('引用错了');
    expect(mine.username).toBe(USER_VIEWER);
    expect(mine.sourceDocs).toEqual([DOC_NAME]);
    expect(mine.refKbId).toBe(KB_ID);
    expect(mine.refKbName).toBe(`统计测试库_${RUN}`);
    expect(mine.reflowed).toBe(false);
  });

  it('like 清空 reason/note，避免残留脏数据', async () => {
    const res = await probe('POST', `/api/v1/messages/msg_s_a1_${RUN}/feedback`, {
      token: viewerToken,
      body: { type: 'like' },
    });
    expect(res.status).toBe(201);

    const row = await prisma.message.findUnique({ where: { id: `msg_s_a1_${RUN}` } });
    expect(row.feedback).toBe('like');
    expect(row.feedbackReason).toBeNull();
    expect(row.feedbackNote).toBeNull();
  });

  it('非法 reason 返回 400（DTO 白名单校验）', async () => {
    const res = await probe('POST', `/api/v1/messages/msg_s_a2_${RUN}/feedback`, {
      token: viewerToken,
      body: { type: 'dislike', reason: 'hack' },
    });
    expect(res.status).toBe(400);
  });

  it('越权（admin 点他人会话内消息）返回 404', async () => {
    const res = await probe('POST', `/api/v1/messages/msg_s_a1_${RUN}/feedback`, {
      token: adminToken,
      body: { type: 'dislike', reason: 'other' },
    });
    expect(res.status).toBe(404);
  });

  it('回流为 hardcase 后 reflowed=true；同库同 question 重复创建 400（查重兜底）', async () => {
    const payload = {
      question: '知识库迁移方案是什么？',
      docNameContains: DOC_NAME,
      keywords: ['迁移'],
      isHard: true,
      source: 'hardcase',
    };
    const created = await probe('POST', `/api/v1/knowledge/${KB_ID}/eval-cases`, {
      token: adminToken,
      body: payload,
    });
    expect(created.status).toBe(201);

    const dup = await probe('POST', `/api/v1/knowledge/${KB_ID}/eval-cases`, {
      token: adminToken,
      body: payload,
    });
    expect(dup.status).toBe(400);

    const res = await probe('GET', '/api/v1/stats/feedback', { token: adminToken });
    const mine = (res.body.data.disliked as Array<Record<string, any>>).find(
      (r) => r.id === `msg_s_a2_${RUN}`
    );
    expect(mine.reflowed).toBe(true);
  });
});
