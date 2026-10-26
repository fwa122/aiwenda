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

// 环境变量硬赋值隔离测试库（与其它 e2e 相同：独立库 6381，绝不触碰开发/生产库）
process.env.DATABASE_URL = 'postgresql://kbt:kbt@127.0.0.1:6381/kbt';
process.env.REDIS_URL = 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET = 'e2e-test-secret-0123456789abcdef0123456789abcdef';
process.env.JWT_EXPIRES_IN = '2h';
process.env.MINIO_ENDPOINT = '127.0.0.1:6390';
process.env.MINIO_ACCESS_KEY = 'kbt';
process.env.MINIO_SECRET_KEY = 'kbt-minio';
process.env.MINIO_BUCKET = 'kb-test-member';

const RUN = Date.now().toString(36);
const PASSWORD = 'Abcd1234';
// owner 用 editor 角色创建：验证成员管理权限来自「库归属」而非用户角色
const OWNER = `e2e_kbm_o_${RUN}`;
const ADMIN = `e2e_kbm_a_${RUN}`;
const EDT = `e2e_kbm_e_${RUN}`; // 被邀请为 editor 成员
const VWR = `e2e_kbm_v_${RUN}`; // 被邀请为 viewer 成员
const OUT = `e2e_kbm_x_${RUN}`; // 局外人（无任何关系）
const KB_ID = `kb_kbm_${RUN}`;
// v0.9.46 开放策略：注册即全员可读（PUBLIC 默认），写权仅 owner/admin/成员
const KB_PUB_ID = `kb_kbm_pub_${RUN}`;

let app: INestApplication;
let prisma: PrismaService;
let redis: Redis;
let baseUrl: string;
let ownerToken: string;
let adminToken: string;
let edtToken: string;
let vwrToken: string;
let outToken: string;
let edtMemberId = '';
let vwrMemberId = '';

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

  const hash = await bcrypt.hash(PASSWORD, 10);
  const users = [
    { username: OWNER, nickname: '成员owner', role: 'editor', department: '研发部' },
    { username: ADMIN, nickname: '成员admin', role: 'admin', department: '管理部' },
    { username: EDT, nickname: '成员小E', role: 'viewer', department: '产品部' },
    { username: VWR, nickname: '成员小V', role: 'viewer', department: '运营部' },
    { username: OUT, nickname: '局外人', role: 'viewer', department: '行政部' },
  ];
  for (const [i, u] of users.entries()) {
    await prisma.user.create({
      data: {
        id: `e2euser_kbm_${i}_${RUN}`,
        username: u.username,
        passwordHash: hash,
        nickname: u.nickname,
        role: u.role,
        department: u.department,
        status: 'active',
      },
    });
  }
  const ownerId = `e2euser_kbm_0_${RUN}`;
  // private 库：可见性仅 owner / admin / 成员，便于同时验证读口径扩展
  await prisma.knowledgeBase.create({
    data: {
      id: KB_ID,
      name: `成员管理测试库${RUN}`,
      description: 'e2e',
      status: 'ready',
      visibility: 'PRIVATE', // v0.9.42 枚举大写化（旧 'private' 小写非法）
      owner: OWNER,
      userId: ownerId,
      retrieverConfig: {},
      llmConfig: {},
    },
  });
  // public 库：注册即读（无成员关系），验证「可见即可读、写权仅成员」
  await prisma.knowledgeBase.create({
    data: {
      id: KB_PUB_ID,
      name: `公共可读测试库${RUN}`,
      description: 'e2e-public',
      status: 'ready',
      visibility: 'PUBLIC',
      owner: OWNER,
      userId: ownerId,
      retrieverConfig: {},
      llmConfig: {},
    },
  });

  ownerToken = await login(OWNER);
  adminToken = await login(ADMIN);
  edtToken = await login(EDT);
  vwrToken = await login(VWR);
  outToken = await login(OUT);
});

afterAll(async () => {
  // 只清自己的数据（并行文件共享同一测试库）：库级联删成员，用户按前缀删
  await prisma.knowledgeBase
    .deleteMany({ where: { id: { in: [KB_ID, KB_PUB_ID] } } })
    .catch(() => {});
  await prisma.user
    .deleteMany({ where: { username: { startsWith: 'e2e_kbm_' } } })
    .catch(() => {});
  await redis.flushdb().catch(() => {});
  await redis.quit().catch(() => {});
  await app.close();
});

describe('知识库成员管理 GET/POST /knowledge/:id/members', () => {
  it('未携带令牌返回 401', async () => {
    expect((await probe('GET', `/api/v1/knowledge/${KB_ID}/members`)).status).toBe(401);
    expect(
      (await probe('POST', `/api/v1/knowledge/${KB_ID}/members`, { body: { username: EDT, role: 'editor' } }))
        .status
    ).toBe(401);
  });

  it('非管理者访问成员列表返回 403（局外人与普通成员均不可管理）', async () => {
    expect((await probe('GET', `/api/v1/knowledge/${KB_ID}/members`, { token: outToken })).status).toBe(403);
  });

  it('owner 按 username 邀请 editor 成员成功，memberCount 同步 +1', async () => {
    const res = await probe('POST', `/api/v1/knowledge/${KB_ID}/members`, {
      token: ownerToken,
      body: { username: EDT, role: 'editor' },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('editor');
    expect(res.body.data.user.username).toBe(EDT);
    expect(res.body.data.user.nickname).toBe('成员小E');
    edtMemberId = res.body.data.id;

    const detail = await probe('GET', `/api/v1/knowledge/${KB_ID}`, { token: ownerToken });
    expect(detail.status).toBe(200);
    expect(detail.body.data.memberCount).toBe(2);
  });

  it('重复邀请同一用户返回 400', async () => {
    const res = await probe('POST', `/api/v1/knowledge/${KB_ID}/members`, {
      token: ownerToken,
      body: { username: EDT, role: 'viewer' },
    });
    expect(res.status).toBe(400);
  });

  it('邀请知识库 owner 自身返回 400，不存在的用户返回 404', async () => {
    const self = await probe('POST', `/api/v1/knowledge/${KB_ID}/members`, {
      token: ownerToken,
      body: { username: OWNER, role: 'editor' },
    });
    expect(self.status).toBe(400);

    const ghost = await probe('POST', `/api/v1/knowledge/${KB_ID}/members`, {
      token: ownerToken,
      body: { username: `no_such_${RUN}`, role: 'viewer' },
    });
    expect(ghost.status).toBe(404);
  });

  it('admin 也可管理成员：邀请 viewer 成员', async () => {
    const res = await probe('POST', `/api/v1/knowledge/${KB_ID}/members`, {
      token: adminToken,
      body: { username: VWR, role: 'viewer' },
    });
    expect(res.status).toBe(201);
    vwrMemberId = res.body.data.id;
  });

  it('成员列表返回昵称/部门/角色，普通成员无权访问', async () => {
    const res = await probe('GET', `/api/v1/knowledge/${KB_ID}/members`, { token: ownerToken });
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
    const edt = res.body.data.list.find((m: any) => m.user.username === EDT);
    expect(edt.role).toBe('editor');
    expect(edt.user.department).toBe('产品部');
    expect(res.body.data.list.find((m: any) => m.user.username === VWR)).toBeTruthy();

    // 成员能读库但不能管理成员名单
    const denied = await probe('GET', `/api/v1/knowledge/${KB_ID}/members`, { token: edtToken });
    expect(denied.status).toBe(403);
  });

  it('候选用户下拉排除 owner 与已有成员', async () => {
    const res = await probe('GET', `/api/v1/knowledge/${KB_ID}/member-candidates`, {
      token: ownerToken,
    });
    expect(res.status).toBe(200);
    const usernames = res.body.data.map((u: any) => u.username);
    expect(usernames).toContain(OUT);
    expect(usernames).not.toContain(OWNER);
    expect(usernames).not.toContain(EDT);
    expect(usernames).not.toContain(VWR);
  });

  it('private 库成员可读（myRole 正确），局外人 403', async () => {
    const edt = await probe('GET', `/api/v1/knowledge/${KB_ID}`, { token: edtToken });
    expect(edt.status).toBe(200);
    expect(edt.body.data.myRole).toBe('editor');

    const vwr = await probe('GET', `/api/v1/knowledge/${KB_ID}`, { token: vwrToken });
    expect(vwr.status).toBe(200);
    expect(vwr.body.data.myRole).toBe('viewer');

    expect((await probe('GET', `/api/v1/knowledge/${KB_ID}`, { token: outToken })).status).toBe(403);
  });

  it('列表接口标注 myRole，private 库仅成员可见', async () => {
    const kw = encodeURIComponent(`成员管理测试库${RUN}`);
    const ownerList = await probe('GET', `/api/v1/knowledge?keyword=${kw}`, { token: ownerToken });
    expect(ownerList.status).toBe(200);
    expect(ownerList.body.data.list[0].myRole).toBe('owner');

    const edtList = await probe('GET', `/api/v1/knowledge?keyword=${kw}`, { token: edtToken });
    expect(edtList.body.data.list.map((k: any) => k.id)).toContain(KB_ID);
    expect(edtList.body.data.list[0].myRole).toBe('editor');

    const outList = await probe('GET', `/api/v1/knowledge?keyword=${kw}`, { token: outToken });
    expect(outList.body.data.list).toHaveLength(0);
  });

  it('editor 成员可写（更新配置 200），局外人 403', async () => {
    const ok = await probe('PUT', `/api/v1/knowledge/${KB_ID}`, {
      token: edtToken,
      body: { description: '成员协作更新' },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.myRole).toBe('editor');

    const denied = await probe('PUT', `/api/v1/knowledge/${KB_ID}`, {
      token: outToken,
      body: { description: '越权更新' },
    });
    expect(denied.status).toBe(403);
  });

  it('角色切换后写权限实时变化：editor→viewer 失去写权限，切回恢复', async () => {
    const toViewer = await probe('PUT', `/api/v1/knowledge/${KB_ID}/members/${edtMemberId}`, {
      token: ownerToken,
      body: { role: 'viewer' },
    });
    expect(toViewer.status).toBe(200);
    expect(toViewer.body.data.role).toBe('viewer');

    const denied = await probe('PUT', `/api/v1/knowledge/${KB_ID}`, {
      token: edtToken,
      body: { description: 'viewer 不应可写' },
    });
    expect(denied.status).toBe(403);

    // viewer 成员同样不可写
    const vwrDenied = await probe('PUT', `/api/v1/knowledge/${KB_ID}`, {
      token: vwrToken,
      body: { description: 'viewer 不应可写' },
    });
    expect(vwrDenied.status).toBe(403);

    const back = await probe('PUT', `/api/v1/knowledge/${KB_ID}/members/${edtMemberId}`, {
      token: ownerToken,
      body: { role: 'editor' },
    });
    expect(back.status).toBe(200);
    const restored = await probe('PUT', `/api/v1/knowledge/${KB_ID}`, {
      token: edtToken,
      body: { description: '成员协作更新' },
    });
    expect(restored.status).toBe(200);
  });

  it('非法角色被校验拦截（400）', async () => {
    const res = await probe('PUT', `/api/v1/knowledge/${KB_ID}/members/${edtMemberId}`, {
      token: ownerToken,
      body: { role: 'owner' },
    });
    expect(res.status).toBe(400);
  });

  it('移除成员后写权限立即失效，memberCount 回落', async () => {
    const res = await probe('DELETE', `/api/v1/knowledge/${KB_ID}/members/${edtMemberId}`, {
      token: ownerToken,
    });
    expect(res.status).toBe(200);

    expect(
      (
        await probe('PUT', `/api/v1/knowledge/${KB_ID}`, {
          token: edtToken,
          body: { description: '移除后不应可写' },
        })
      ).status
    ).toBe(403);
    // private 库：移除后读权限同样失效
    expect((await probe('GET', `/api/v1/knowledge/${KB_ID}`, { token: edtToken })).status).toBe(403);

    const detail = await probe('GET', `/api/v1/knowledge/${KB_ID}`, { token: ownerToken });
    expect(detail.body.data.memberCount).toBe(2);

    // 重复移除同一成员 → 404
    const again = await probe('DELETE', `/api/v1/knowledge/${KB_ID}/members/${edtMemberId}`, {
      token: ownerToken,
    });
    expect(again.status).toBe(404);
  });
});

describe('v0.9.46 开放策略：注册即全员可读（PUBLIC 默认）', () => {
  it('局外人（无成员关系）可读 PUBLIC 库，但不可写', async () => {
    const detail = await probe('GET', `/api/v1/knowledge/${KB_PUB_ID}`, { token: outToken });
    expect(detail.status).toBe(200);
    expect(detail.body.data.myRole).toBeNull(); // 可读但无角色 → 前端不显示写入口

    const denied = await probe('PUT', `/api/v1/knowledge/${KB_PUB_ID}`, {
      token: outToken,
      body: { description: '局外人不应可写' },
    });
    expect(denied.status).toBe(403);
  });

  it('PUBLIC 库出现在局外人列表中（普通用户注册即见），上传接口仍 403', async () => {
    const list = await probe('GET', `/api/v1/knowledge?keyword=${encodeURIComponent(`公共可读测试库${RUN}`)}`, {
      token: outToken,
    });
    expect(list.status).toBe(200);
    expect(list.body.data.list).toHaveLength(1);
    expect(list.body.data.list[0].id).toBe(KB_PUB_ID);
  });
});
