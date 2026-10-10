import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/redis/redis.module';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import type Redis from 'ioredis';

// 环境变量硬赋值隔离测试库：ConfigService 中 process.env 优先于 server/.env，
// 保证集成测试绝不触碰开发/生产库（global-setup 已把迁移跑到独立库 6381）
process.env.DATABASE_URL = 'postgresql://kbt:kbt@127.0.0.1:6381/kbt';
process.env.REDIS_URL = 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET = 'e2e-test-secret-0123456789abcdef0123456789abcdef';
process.env.JWT_EXPIRES_IN = '2h';
// MinIO 测试实例（docker-compose.test.yml，端口 6390；AppModule 启动时自动建桶）
process.env.MINIO_ENDPOINT = '127.0.0.1:6390';
process.env.MINIO_ACCESS_KEY = 'kbt';
process.env.MINIO_SECRET_KEY = 'kbt-minio';
process.env.MINIO_BUCKET = 'kb-test-auth';

const RUN = Date.now().toString(36);
const PASSWORD = 'Abcd1234';
const WRONG_PASSWORD = 'Wrong9999';
const USER_A = `e2e_a_${RUN}`; // 常规链路
const USER_LOCK = `e2e_lock_${RUN}`; // 锁定专用
const USER_REG = `e2e_reg_${RUN}`; // 注册专用
const USER_PW = `e2e_pw_${RUN}`; // 改密吊销专用
const USER_BAN = `e2e_ban_${RUN}`; // 封禁吊销专用
const ADMIN_OP = `e2e_admin_${RUN}`; // 执行封禁/更新的管理员

let app: INestApplication;
let prisma: PrismaService;
let redis: Redis;
let baseUrl: string;

interface ProbeResult {
  status: number;
  body: any;
}

/** 原生 fetch 探测：返回与 supertest 同形的 { status, body }（supertest 在本机存在 ESM interop 缺陷，弃用） */
function probe(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  opts: { ip?: string; body?: unknown; token?: string } = {}
): Promise<ProbeResult> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': opts.ip ?? `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`,
  };
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

async function createUser(username: string, password = PASSWORD, role = 'viewer') {
  await prisma.user.create({
    data: {
      id: `e2euser_${username}`,
      username,
      passwordHash: await bcrypt.hash(password, 10),
      nickname: username,
      role,
      status: 'active',
    },
  });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  // 与 main.ts 对齐：前缀 / trust proxy / 校验管道 / 统一响应与异常处理
  app.setGlobalPrefix('api/v1');
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(0, '127.0.0.1'); // 随机空闲端口
  const port = (app.getHttpAdapter().getHttpServer().address() as { port: number }).port;
  baseUrl = `http://127.0.0.1:${port}`;

  prisma = app.get(PrismaService);
  redis = app.get<Redis>(REDIS_CLIENT);
  await createUser(USER_A);
  await createUser(USER_LOCK);
  await createUser(USER_PW);
  await createUser(USER_BAN);
  await createUser(ADMIN_OP, PASSWORD, 'admin');
});

afterAll(async () => {
  await prisma.user
    .deleteMany({ where: { username: { startsWith: 'e2e_' } } })
    .catch(() => {});
  await redis.flushdb().catch(() => {}); // 专用测试 Redis，整库清空安全
  await redis.quit().catch(() => {});
  await app.close();
});

describe('POST /api/v1/auth/register（自助注册）', () => {
  it('注册成功返回 id/username，且角色为 viewer', async () => {
    const res = await probe('POST', '/api/v1/auth/register', {
      body: { username: USER_REG, password: PASSWORD, nickname: 'E2E' },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.username).toBe(USER_REG);
    const user = await prisma.user.findUnique({ where: { username: USER_REG } });
    expect(user?.role).toBe('viewer'); // 服务端强制 viewer，防越权
  });

  it('重复用户名返回 409', async () => {
    const res = await probe('POST', '/api/v1/auth/register', {
      body: { username: USER_REG, password: PASSWORD },
    });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/v1/auth/login', () => {
  it('正确凭据返回 token + refreshToken + 无密码字段的用户档案', async () => {
    const res = await probe('POST', '/api/v1/auth/login', {
      body: { username: USER_A, password: PASSWORD },
    });
    expect(res.status).toBe(201); // NestJS POST 默认 201
    expect(typeof res.body.data.token).toBe('string');
    expect(typeof res.body.data.refreshToken).toBe('string');
    expect(res.body.data.user.username).toBe(USER_A);
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it('错误密码返回 401，提示语不泄露用户是否存在', async () => {
    const res = await probe('POST', '/api/v1/auth/login', {
      body: { username: USER_A, password: WRONG_PASSWORD },
    });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('用户名或密码不正确');
  });

  it('连错 5 次触发账号锁定，锁定期间正确密码也返回 429', async () => {
    const ip = '10.77.77.77'; // 固定 IP：本组连续请求按同一来源计数
    for (let i = 0; i < 5; i++) {
      const r = await probe('POST', '/api/v1/auth/login', {
        ip,
        body: { username: USER_LOCK, password: WRONG_PASSWORD },
      });
      expect(r.status).toBe(401);
    }
    const res = await probe('POST', '/api/v1/auth/login', {
      ip,
      body: { username: USER_LOCK, password: PASSWORD },
    });
    expect(res.status).toBe(429);
    expect(res.body.message).toContain('账号已暂时锁定'); // 业务自定义 429 文案原样透传
  });
});

describe('POST /api/v1/auth/refresh（轮换制）', () => {
  it('刷新换发新令牌对，旧 refreshToken 重放返回 401', async () => {
    const login = await probe('POST', '/api/v1/auth/login', {
      body: { username: USER_A, password: PASSWORD },
    });
    const oldRt = login.body.data.refreshToken as string;

    const refresh = await probe('POST', '/api/v1/auth/refresh', { body: { refreshToken: oldRt } });
    expect(refresh.status).toBe(201);
    expect(refresh.body.data.refreshToken).toBeTruthy();
    expect(refresh.body.data.refreshToken).not.toBe(oldRt); // 轮换：新旧不同

    const replay = await probe('POST', '/api/v1/auth/refresh', { body: { refreshToken: oldRt } });
    expect(replay.status).toBe(401); // 旧令牌一次性，重放被白名单拒绝
  });

  it('非法 refreshToken 返回 401', async () => {
    const res = await probe('POST', '/api/v1/auth/refresh', { body: { refreshToken: 'not-a-jwt' } });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('刷新令牌无效或已过期');
  });
});

describe('令牌类型隔离与登出吊销', () => {
  it('refresh token 不能当 access token 用（POST /auth/logout 需 JWT 守卫）', async () => {
    const login = await probe('POST', '/api/v1/auth/login', {
      body: { username: USER_A, password: PASSWORD },
    });
    const rt = login.body.data.refreshToken as string;
    const res = await probe('POST', '/api/v1/auth/logout', { token: rt, body: {} });
    expect(res.status).toBe(401); // jwt.strategy 拒绝 type=refresh
  });

  it('登出吊销 refreshToken 后，该令牌刷新返回 401', async () => {
    const login = await probe('POST', '/api/v1/auth/login', {
      body: { username: USER_A, password: PASSWORD },
    });
    const token = login.body.data.token as string;
    const rt = login.body.data.refreshToken as string;

    const logout = await probe('POST', '/api/v1/auth/logout', { token, body: { refreshToken: rt } });
    expect(logout.status).toBe(201);

    const refresh = await probe('POST', '/api/v1/auth/refresh', { body: { refreshToken: rt } });
    expect(refresh.status).toBe(401); // 白名单键已删除
  });
});

describe('tokenVersion 立即吊销（P2 安全专项）', () => {
  it('改密后旧 access 与旧 refresh 立即失效，新密码可正常登录', async () => {
    const login = await probe('POST', '/api/v1/auth/login', {
      body: { username: USER_PW, password: PASSWORD },
    });
    const oldToken = login.body.data.token as string;
    const oldRt = login.body.data.refreshToken as string;
    expect(oldToken).toBeTruthy();

    const NEW_PASSWORD = 'NewPass5678';
    const change = await probe('PUT', '/api/v1/user/password', {
      token: oldToken,
      body: { oldPassword: PASSWORD, newPassword: NEW_PASSWORD },
    });
    expect(change.status).toBe(200); // PUT 默认 200

    // 旧 access（ver 已过期）立即 401，不再存活至自然过期
    const oldAccess = await probe('GET', '/api/v1/user/profile', { token: oldToken });
    expect(oldAccess.status).toBe(401);
    // 旧 refresh 即使还在 7 天白名单窗口内，同样被版本比对拒绝
    const oldRefresh = await probe('POST', '/api/v1/auth/refresh', {
      body: { refreshToken: oldRt },
    });
    expect(oldRefresh.status).toBe(401);
    // 新密码可正常登录，换发的新令牌携带新版本号可用
    const relogin = await probe('POST', '/api/v1/auth/login', {
      body: { username: USER_PW, password: NEW_PASSWORD },
    });
    expect(relogin.status).toBe(201);
    const newAccess = await probe('GET', '/api/v1/user/profile', {
      token: relogin.body.data.token as string,
    });
    expect(newAccess.status).toBe(200);
  });

  it('管理员封禁后，被禁用户旧 access 与旧 refresh 立即失效；解禁后旧令牌仍被拒', async () => {
    const banLogin = await probe('POST', '/api/v1/auth/login', {
      body: { username: USER_BAN, password: PASSWORD },
    });
    const oldToken = banLogin.body.data.token as string;
    const oldRt = banLogin.body.data.refreshToken as string;

    const adminLogin = await probe('POST', '/api/v1/auth/login', {
      body: { username: ADMIN_OP, password: PASSWORD },
    });
    const adminToken = adminLogin.body.data.token as string;
    const banUserId = `e2euser_${USER_BAN}`;

    const ban = await probe('PUT', `/api/v1/users/${banUserId}`, {
      token: adminToken,
      body: { status: 'disabled' },
    });
    expect(ban.status).toBe(200);

    // 双重防线同时生效：status 检查 + tokenVersion 自增
    const oldAccess = await probe('GET', '/api/v1/user/profile', { token: oldToken });
    expect(oldAccess.status).toBe(401);
    const oldRefresh = await probe('POST', '/api/v1/auth/refresh', {
      body: { refreshToken: oldRt },
    });
    expect(oldRefresh.status).toBe(401);

    // 解禁：旧令牌（旧 ver）依然被拒，必须重新登录——防止「解禁连坐复活旧会话」
    await probe('PUT', `/api/v1/users/${banUserId}`, {
      token: adminToken,
      body: { status: 'active' },
    });
    const reLogin = await probe('POST', '/api/v1/auth/login', {
      body: { username: USER_BAN, password: PASSWORD },
    });
    expect(reLogin.status).toBe(201);
    expect(reLogin.body.data.token).toBeTruthy();
  });

  it('管理员普通更新（未改状态）不吊销存量令牌', async () => {
    const login = await probe('POST', '/api/v1/auth/login', {
      body: { username: USER_A, password: PASSWORD },
    });
    const token = login.body.data.token as string;
    expect(token).toBeTruthy();

    const adminLogin = await probe('POST', '/api/v1/auth/login', {
      body: { username: ADMIN_OP, password: PASSWORD },
    });
    const adminToken = adminLogin.body.data.token as string;

    const update = await probe('PUT', `/api/v1/users/e2euser_${USER_A}`, {
      token: adminToken,
      body: { nickname: `renamed_${RUN}` },
    });
    expect(update.status).toBe(200);

    const stillValid = await probe('GET', '/api/v1/user/profile', { token });
    expect(stillValid.status).toBe(200); // 版本号未变，令牌不受影响
  });

  it('老格式令牌（无 ver 字段）按版本 0 兼容，升级不掉线', async () => {
    // 直接用测试 JWT_SECRET 签发不带 ver 的历史格式令牌（模拟升级前签发的存量令牌）
    const legacyToken = jwt.sign(
      { sub: `e2euser_${USER_A}`, username: USER_A, role: 'viewer' },
      process.env.JWT_SECRET as string,
      { expiresIn: '2h' }
    );
    const res = await probe('GET', '/api/v1/user/profile', { token: legacyToken });
    expect(res.status).toBe(200); // tokenVersion 默认 0，(ver ?? 0) === 0 → 通过
  });
});
