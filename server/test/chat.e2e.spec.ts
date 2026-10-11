import 'reflect-metadata';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';

/* ==========================================================================
   chat BFF 编排集成测试
   - 独立测试库/Redis（global-setup），与 auth.e2e 同一套基建
   - AiServiceClient 指向本地 mock server（AI_SERVICE_URL 环境变量，模块编译前注入），
     按 question 关键字路由行为：正常流 / 上游 error 事件 / HTTP 500 / 连接拒绝
   - 只测 BFF 编排：SSE 转发、引用落库补全、历史正序、tokens 重算、上游降级
   ========================================================================== */

process.env.DATABASE_URL = 'postgresql://kbt:kbt@127.0.0.1:6381/kbt';
process.env.REDIS_URL = 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET = 'e2e-test-secret-0123456789abcdef0123456789abcdef';
process.env.JWT_EXPIRES_IN = '2h';
// MinIO 测试实例（docker-compose.test.yml，端口 6390；AppModule 启动时自动建桶）
process.env.MINIO_ENDPOINT = '127.0.0.1:6390';
process.env.MINIO_ACCESS_KEY = 'kbt';
process.env.MINIO_SECRET_KEY = 'kbt-minio';
process.env.MINIO_BUCKET = 'kb-test-chat';

const RUN = Date.now().toString(36);
const PASSWORD = 'Abcd1234';
const USERNAME = `chat_${RUN}`;
// API 密钥 e2e 专用：管理员（密钥创建者/归属者）+ scope 内外两个知识库
const ADMIN_NAME = `chat_admin_${RUN}`;
const KB_IN_SCOPE = `kb_in_${RUN}`;
const KB_OUT_SCOPE = `kb_out_${RUN}`;

const REF = {
  kbId: `kb_${RUN}`,
  docId: `doc_${RUN}`,
  chunkId: `chk_${RUN}`,
  chunkIndex: 3,
  page: 2,
  score: 0.87,
};
const PROMPT_TOKENS = 30;
const COMPLETION_TOKENS = 5;

let app: INestApplication;
let prisma: PrismaService;
let baseUrl: string;
let aiMock: http.Server;
let aiMockPort = 0;
/** mock 上游收到的 /internal/chat 请求体历史（按序） */
const receivedChats: any[] = [];
/** mock 上游收到的 title 生成请求次数 */
let titleCalls = 0;

beforeAll(async () => {
  // ---- mock ai-service（node:http，随机端口）----
  aiMock = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.url === '/internal/chat/title') {
        titleCalls++;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ title: '自动标题' }));
        return;
      }
      if (req.url !== '/internal/chat') {
        res.statusCode = 404;
        res.end('{}');
        return;
      }
      const body = JSON.parse(raw || '{}');
      receivedChats.push(body);
      const q: string = body.question || '';

      if (q.includes('HTTP_500')) {
        res.statusCode = 500;
        res.end(JSON.stringify({ detail: 'boom' }));
        return;
      }
      if (q.includes('CONN_FAIL')) {
        // 模拟上游进程崩溃：直接断开 TCP，客户端 fetch 将抛网络错误
        (res as any).socket?.destroy();
        return;
      }
      if (q.includes('RAISE_ERROR')) {
        // 正常开流但中途显式报错
        res.setHeader('Content-Type', 'text/event-stream');
        res.write('data: {"type":"references","data":[]}\n\n');
        res.write('data: {"type":"delta","data":{"content":"部分"}}\n\n');
        res.write('data: {"type":"error","data":{"message":"模型超时"}}\n\n');
        res.end();
        return;
      }
      // 默认正常流：引用 → 两段增量 → done
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(`data: ${JSON.stringify({ type: 'references', data: [REF] })}\n\n`);
      res.write('data: {"type":"delta","data":{"content":"你好"}}\n\n');
      res.write('data: {"type":"delta","data":{"content":"世界"}}\n\n');
      res.write(
        `data: ${JSON.stringify({
          type: 'done',
          data: {
            meta: {
              model: 'test-model',
              elapsedMs: 10,
              tokens: { prompt: PROMPT_TOKENS, completion: COMPLETION_TOKENS },
            },
          },
        })}\n\n`
      );
      res.end();
    });
  });
  await new Promise<void>((resolve) => aiMock.listen(0, '127.0.0.1', resolve));
  aiMockPort = (aiMock.address() as AddressInfo).port;
  // 模块编译前注入：AiServiceClient 构造时读取
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${aiMockPort}`;
  process.env.AI_SERVICE_TOKEN = 'test-internal-token';

  // ---- 启动 BFF（与 main.ts 对齐）----
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
  await prisma.user.create({
    data: {
      id: `e2euser_${USERNAME}`,
      username: USERNAME,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      nickname: USERNAME,
      role: 'viewer',
      status: 'active',
    },
  });
  // API 密钥 e2e 基建：管理员 + 授权范围内外两个库（internal 可见性，viewer/admin 均可读）
  await prisma.user.create({
    data: {
      id: `e2euser_${ADMIN_NAME}`,
      username: ADMIN_NAME,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      nickname: ADMIN_NAME,
      role: 'admin',
      status: 'active',
    },
  });
  await prisma.knowledgeBase.createMany({
    data: [KB_IN_SCOPE, KB_OUT_SCOPE].map((id) => ({
      id,
      name: id,
      retrieverConfig: {},
      llmConfig: {},
      visibility: 'internal',
      userId: `e2euser_${ADMIN_NAME}`,
    })),
  });
});

afterAll(async () => {
  const userIds = [`e2euser_${USERNAME}`, `e2euser_${ADMIN_NAME}`];
  const convs = await prisma.conversation
    .findMany({ where: { userId: { in: userIds } }, select: { id: true } })
    .catch(() => []);
  const convIds = convs.map((c) => c.id);
  const msgs = convIds.length
    ? await prisma.message.findMany({ where: { conversationId: { in: convIds } }, select: { id: true } }).catch(() => [])
    : [];
  await prisma.messageSource
    .deleteMany({ where: { messageId: { in: msgs.map((m) => m.id) } } })
    .catch(() => {});
  await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } }).catch(() => {});
  await prisma.conversation.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
  await prisma.apiKey.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
  await prisma.knowledgeBase.deleteMany({ where: { id: { in: [KB_IN_SCOPE, KB_OUT_SCOPE] } } }).catch(() => {});
  await prisma.$executeRaw`DELETE FROM daily_stats WHERE date = CURRENT_DATE`.catch(() => {});
  await prisma.user.deleteMany({ where: { username: { startsWith: 'chat_' } } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
  await new Promise<void>((resolve) => aiMock.close(() => resolve()));
  await app.close();
});

/** 登录拿 token */
async function login(username = USERNAME): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `10.9.9.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const body = await res.json();
  return body.data.token;
}

/** 管理员创建 API 密钥，返回一次性明文 */
async function createApiKey(opts: { scope?: string[]; quotaPerDay?: number; expiredAt?: string } = {}) {
  const token = await login(ADMIN_NAME);
  const res = await fetch(`${baseUrl}/api/v1/api-keys`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `10.8.8.${Math.floor(Math.random() * 200) + 1}`,
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name: 'e2e-key',
      scope: opts.scope ?? [],
      quotaPerDay: opts.quotaPerDay ?? 1000,
      ...(opts.expiredAt ? { expiredAt: opts.expiredAt } : {}),
    }),
  });
  const body = await res.json();
  return body.data.key as string;
}

/** SSE 探测：POST completions 并读取完整事件流（读到流结束） */
async function sseProbe(
  token: string,
  body: Record<string, unknown>,
  ip = `10.${Math.floor(Math.random() * 250) + 1}.1.1`
): Promise<{ status: number; events: { type: string; data: any }[] }> {
  const res = await fetch(`${baseUrl}/api/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (res.headers.get('content-type')?.includes('json')) {
    return { status: res.status, events: [] };
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const events: { type: string; data: any }[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        try {
          const evt = JSON.parse(raw);
          if (evt?.type) events.push(evt);
        } catch {
          /* 忽略心跳 */
        }
      }
    }
  }
  return { status: res.status, events };
}

const typesOf = (events: { type: string }[]) => events.map((e) => e.type);

describe('POST /api/v1/chat/completions（BFF 编排，mock ai-service）', () => {
  it('happy path：引用落库补全 → 增量透传 → done 重算 tokens → 自动命名 → 落库收尾', async () => {
    const token = await login();
    const { status, events } = await sseProbe(token, {
      question: '第一轮问题',
      kbIds: [],
      model: 'test-model',
    });
    expect(status).toBe(200);

    // 事件序列与载荷
    expect(typesOf(events)).toEqual(['references', 'delta', 'delta', 'done', 'title']);
    expect(events[0].data[0]).toMatchObject({
      index: 1,
      docId: REF.docId,
      chunkIndex: REF.chunkIndex,
      score: REF.score,
      page: REF.page,
    });
    expect(events[1].data.content).toBe('你好');
    expect(events[2].data.content).toBe('世界');
    const done = events[3].data;
    expect(done.conversationId).toBeTruthy();
    expect(done.messageId).toBeTruthy();
    // BFF 侧重算 total = prompt + completion
    expect(done.meta.tokens).toEqual({ prompt: PROMPT_TOKENS, completion: COMPLETION_TOKENS, total: 35 });

    // 自动命名：首轮占位标题被 LLM 标题覆盖
    expect(events[4].data).toEqual({ conversationId: done.conversationId, title: '自动标题' });
    const conv = await prisma.conversation.findUnique({ where: { id: done.conversationId } });
    expect(conv?.title).toBe('自动标题');

    // 落库：assistant 正文与状态、会话计数与 token 用量
    const msgs = await prisma.message.findMany({
      where: { conversationId: done.conversationId },
      orderBy: { createdAt: 'asc' },
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ role: 'user', content: '第一轮问题', status: 'done' });
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: '你好世界', status: 'done' });
    expect(conv?.messageCount).toBe(2);
    expect(conv?.tokenUsed).toBe(35);

    // 转发体：首轮 history 为空、强制引用默认开启
    expect(receivedChats[0].history).toEqual([]);
    expect(receivedChats[0].forceCitation).toBe(true);
    expect(receivedChats[0].question).toBe('第一轮问题');
  });

  it('第二轮：历史消息以时间正序传入上游（v0.9.22 修复的链路级验证）', async () => {
    const token = await login();
    const first = await sseProbe(token, { question: '第一轮问题', kbIds: [], model: 'test-model' });
    const convId = first.events[3].data.conversationId;

    await sseProbe(token, {
      question: '第二轮问题',
      conversationId: convId,
      kbIds: [],
      model: 'test-model',
    });
    const second = receivedChats[receivedChats.length - 1];
    expect(second.history).toEqual([
      { role: 'user', content: '第一轮问题' },
      { role: 'assistant', content: '你好世界' },
    ]);
  });

  it('上游 error 事件：SSE 转发 error，正文保留、消息标记 error', async () => {
    const token = await login();
    const { events } = await sseProbe(token, { question: 'RAISE_ERROR', kbIds: [], model: 'test-model' });
    expect(typesOf(events)).toEqual(['references', 'delta', 'error']);
    expect(events[2].data.message).toBe('模型超时');

    // 落库收尾：content 保留已收正文，状态 error
    const conv = await prisma.conversation.findFirst({
      where: { userId: `e2euser_${USERNAME}`, title: 'RAISE_ERROR' },
    });
    const msgs = await prisma.message.findMany({
      where: { conversationId: conv!.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: '部分', status: 'error' });
  });

  it('上游 HTTP 500：转为 SSE error 事件（AI 服务响应异常）', async () => {
    const token = await login();
    const { status, events } = await sseProbe(token, { question: 'HTTP_500', kbIds: [], model: 'test-model' });
    expect(status).toBe(200); // SSE 已开始，HTTP 层恒 200
    expect(typesOf(events)).toEqual(['error']);
    expect(events[0].data.message).toContain('HTTP 500');
  });

  it('上游连接拒绝（TCP 断开）：转为 SSE error 事件（连接失败）', async () => {
    const token = await login();
    const { events } = await sseProbe(token, { question: 'CONN_FAIL', kbIds: [], model: 'test-model' });
    expect(typesOf(events)).toEqual(['error']);
    expect(events[0].data.message).toContain('AI 服务连接失败');
  });

  it('他人会话：404 JSON（SSE 未开始），不泄漏会话存在性', async () => {
    const token = await login();
    const res = await fetch(`${baseUrl}/api/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '10.7.7.7',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ question: '越权探测', conversationId: 'conv_not_exists', kbIds: [] }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toBe('会话不存在');
  });
});

describe('API 密钥认证闭环（ApiKeyAuthGuard 双通道）', () => {
  it('scope 内问答：sk-kb-* 密钥直连 completions，检索范围默认收敛到授权库', async () => {
    const key = await createApiKey({ scope: [KB_IN_SCOPE] });
    const { status, events } = await sseProbe(key, { question: 'APIKEY_OK', kbIds: [], model: 'test-model' });
    expect(status).toBe(200);
    expect(typesOf(events)).toEqual(['references', 'delta', 'delta', 'done', 'title']);

    // scope 收敛生效：请求 kbIds 为空 → 下游收到授权库全集（而非全库）
    expect(receivedChats[receivedChats.length - 1].kbIds).toEqual([KB_IN_SCOPE]);

    // 用量计数：usedToday 自增 + lastUsedAt 记录
    const row = await prisma.apiKey.findFirst({ where: { keyPreview: { startsWith: 'sk-kb-' } }, orderBy: { createdAt: 'asc' } });
    expect(row?.usedToday).toBeGreaterThanOrEqual(1);
    expect(row?.lastUsedAt).toBeTruthy();
  });

  it('指定授权范围外的 kbId → 403，SSE 未开始返回 JSON', async () => {
    const key = await createApiKey({ scope: [KB_IN_SCOPE] });
    const { status, events } = await sseProbe(key, {
      question: 'APIKEY越权',
      kbIds: [KB_OUT_SCOPE],
      model: 'test-model',
    });
    expect(status).toBe(403);
    expect(events).toEqual([]);
    // 上游从未收到该请求（越权调用不产生 LLM 消耗）
    expect(receivedChats.some((c: any) => c.question === 'APIKEY越权')).toBe(false);
  });

  it('scope 为空（未授权）的密钥 → 403', async () => {
    const key = await createApiKey({ scope: [] });
    const { status } = await sseProbe(key, { question: 'APIKEY空scope', kbIds: [] });
    expect(status).toBe(403);
  });

  it('无效密钥 / 过期密钥 → 401', async () => {
    const bad = await sseProbe('sk-kb-00000000deadbeef', { question: 'APIKEY无效', kbIds: [] });
    expect(bad.status).toBe(401);

    const expired = await createApiKey({
      scope: [KB_IN_SCOPE],
      expiredAt: new Date(Date.now() - 3600_000).toISOString(),
    });
    const res = await sseProbe(expired, { question: 'APIKEY过期', kbIds: [] });
    expect(res.status).toBe(401);
  });

  it('每日配额：quotaPerDay=1 首发成功、次发 429', async () => {
    const key = await createApiKey({ scope: [KB_IN_SCOPE], quotaPerDay: 1 });
    const first = await sseProbe(key, { question: 'APIKEY配额1', kbIds: [], model: 'test-model' });
    expect(first.status).toBe(200);
    const second = await sseProbe(key, { question: 'APIKEY配额2', kbIds: [] });
    expect(second.status).toBe(429);
    const body = await fetch(`${baseUrl}/api/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.6.6.6', authorization: `Bearer ${key}` },
      body: JSON.stringify({ question: 'APIKEY配额3' }),
    }).then((r) => r.json());
    expect(body.message).toContain('今日调用配额已用尽');
  });

  it('JWT 通道回归：既有登录用户行为不受影响', async () => {
    const token = await login();
    const { status } = await sseProbe(token, { question: 'JWT回归', kbIds: [], model: 'test-model' });
    expect(status).toBe(200);
  });
});
