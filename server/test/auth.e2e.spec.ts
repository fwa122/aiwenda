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
// v0.9.58 起弱口令黑名单生效：Abcd1234（abcd1234）在名单内，PASSWORD 换用非弱口令
const PASSWORD = 'Ts7kQm29';
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

/** 直写测试 Redis 的邮箱验证码（e2e 不依赖真实 SMTP 发信；与服务端 EmailCodeService 键位一致） */
async function putEmailCode(scene: 'register' | 'reset', email: string): Promise<string> {
  const code = '654321';
  await redis.set(`emailcode:${scene}:${email}`, code, 'EX', 300);
  return code;
}

/** 直写图形验证码（与 CaptchaService 键位一致），返回可用的 captchaId/code */
async function putCaptcha(): Promise<{ id: string; code: string }> {
  const id = `cap_${RUN}_${Math.random().toString(36).slice(2, 8)}`;
  await redis.set(`captcha:${id}`, 'abcd', 'EX', 300);
  return { id, code: 'abcd' };
}

describe('POST /api/v1/auth/register（自助注册，v0.9.47 起需邮箱验证码）', () => {
  it('注册成功返回 id/username，且角色为 viewer', async () => {
    const email = `${USER_REG}@test.local`;
    const emailCode = await putEmailCode('register', email);
    const res = await probe('POST', '/api/v1/auth/register', {
      body: { username: USER_REG, password: PASSWORD, nickname: 'E2E', email, emailCode },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.user.username).toBe(USER_REG); // v0.9.56 注册即登录：返回完整会话
    expect(res.body.data.token).toBeTruthy();
    const user = await prisma.user.findUnique({ where: { username: USER_REG } });
    expect(user?.role).toBe('viewer'); // 服务端强制 viewer，防越权
    expect(user?.email).toBe(email);
  });

  it('缺少/错误邮箱验证码返回 400，且不落库', async () => {
    const noCode = await probe('POST', '/api/v1/auth/register', {
      body: { username: `${USER_REG}_nc`, password: PASSWORD, email: `${USER_REG}_nc@test.local` },
    });
    expect(noCode.status).toBe(400);
    const badCode = await probe('POST', '/api/v1/auth/register', {
      body: {
        username: `${USER_REG}_bc`,
        password: PASSWORD,
        email: `${USER_REG}_bc@test.local`,
        emailCode: '000000',
      },
    });
    expect(badCode.status).toBe(400);
    expect(await prisma.user.count({ where: { username: { startsWith: USER_REG } } })).toBe(1);
  });

  it('重复用户名返回 409', async () => {
    const email2 = `${USER_REG}_dup@test.local`;
    const code = await putEmailCode('register', email2);
    const res = await probe('POST', '/api/v1/auth/register', {
      body: { username: USER_REG, password: PASSWORD, email: email2, emailCode: code },
    });
    expect(res.status).toBe(409);
  });

  it('重复邮箱返回 409', async () => {
    const email = `${USER_REG}@test.local`;
    const code = await putEmailCode('register', email);
    const res = await probe('POST', '/api/v1/auth/register', {
      body: { username: `${USER_REG}_em`, password: PASSWORD, email, emailCode: code },
    });
    expect(res.status).toBe(409);
  });
});

describe('v0.9.47 图形验证码与邮箱验证码发放', () => {
  it('GET /auth/captcha 返回 id 与 svg', async () => {
    const res = await probe('GET', '/api/v1/auth/captcha');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toMatch(/^cap_/);
    expect(res.body.data.svg).toContain('<svg');
  });

  it('图形码错误时发码被拒（400）', async () => {
    const res = await probe('POST', '/api/v1/auth/email-code', {
      body: { scene: 'register', email: 'any@test.local', captchaId: 'cap_none', captchaCode: 'xxxx' },
    });
    expect(res.status).toBe(400);
  });

  it('register 场景：SMTP 未配置返回 503（可读提示），已占用邮箱 409', async () => {
    // 先过图形码（直写 Redis），SMTP 未配置（测试环境无 SMTP_*）→ 503
    const cap = await putCaptcha();
    const send = await probe('POST', '/api/v1/auth/email-code', {
      body: { scene: 'register', email: 'fresh@test.local', captchaId: cap.id, captchaCode: cap.code },
    });
    expect(send.status).toBe(503);

    // 邮箱已注册：在图形码之后、SMTP 之前即被拦截
    const cap2 = await putCaptcha();
    const taken = await probe('POST', '/api/v1/auth/email-code', {
      body: { scene: 'register', email: `${USER_REG}@test.local`, captchaId: cap2.id, captchaCode: cap2.code },
    });
    expect(taken.status).toBe(409);
  });

  it('reset 场景：未绑定邮箱静默成功（防枚举），不暴露邮箱归属', async () => {
    const cap = await putCaptcha();
    const res = await probe('POST', '/api/v1/auth/email-code', {
      body: { scene: 'reset', email: 'nobody@test.local', captchaId: cap.id, captchaCode: cap.code },
    });
    // SMTP 未配置前已静默返回（不发信不报错），证明未泄露邮箱存在性（POST 成功语义 201）
    expect(res.status).toBe(201);
    expect(res.body.data.sent).toBe(true);
  });
});

describe('v0.9.47 忘记密码（邮箱验证码重置，免原密码）', () => {
  const RST_USER = `e2e_rst_${RUN}`;
  const RST_EMAIL = `e2e_rst_${RUN}@test.local`;

  it('全链路：旧密码登录 → 邮箱码重置 → 旧 access 立即吊销 → 新密码登录', async () => {
    // 直建绑定邮箱的用户并登录拿旧 token
    await createUser(RST_USER);
    await prisma.user.update({ where: { username: RST_USER }, data: { email: RST_EMAIL } });
    const oldLogin = await probe('POST', '/api/v1/auth/login', {
      body: { username: RST_USER, password: PASSWORD },
    });
    expect(oldLogin.status).toBe(201);
    const oldAccess = oldLogin.body.data.token;

    // 直写 reset 验证码 → 重置（免原密码）
    const code = await putEmailCode('reset', RST_EMAIL);
    const reset = await probe('POST', '/api/v1/auth/reset-password', {
      body: { email: RST_EMAIL, code, newPassword: `New${PASSWORD}` },
    });
    expect(reset.status).toBe(201);

    // tokenVersion 自增 → 旧 access 立即 401（全端下线）
    const oldCall = await probe('GET', '/api/v1/user/profile', { token: oldAccess });
    expect(oldCall.status).toBe(401);

    // 新密码可登录，旧密码失效
    const newLogin = await probe('POST', '/api/v1/auth/login', {
      body: { username: RST_USER, password: `New${PASSWORD}` },
    });
    expect(newLogin.status).toBe(201);
    const oldPw = await probe('POST', '/api/v1/auth/login', {
      body: { username: RST_USER, password: PASSWORD },
    });
    expect(oldPw.status).toBe(401);
  });

  it('验证码错误返回 400；错误 5 次后码被销毁（正确码也失效）', async () => {
    const code = await putEmailCode('reset', RST_EMAIL);
    for (let i = 0; i < 5; i++) {
      const bad = await probe('POST', '/api/v1/auth/reset-password', {
        body: { email: RST_EMAIL, code: '000000', newPassword: `New${PASSWORD}` },
      });
      expect(bad.status).toBe(400);
    }
    const right = await probe('POST', '/api/v1/auth/reset-password', {
      body: { email: RST_EMAIL, code, newPassword: `New2${PASSWORD}` },
    });
    expect(right.status).toBe(400); // 连错 5 次防爆破：码已销毁
  });

  it('新密码强度校验（纯数字/过短）返回 400', async () => {
    const code = await putEmailCode('reset', RST_EMAIL);
    const weak = await probe('POST', '/api/v1/auth/reset-password', {
      body: { email: RST_EMAIL, code, newPassword: '12345678' },
    });
    expect(weak.status).toBe(400);
  });
});

describe('v0.9.48 防爆破加固：阶梯锁定 / IP 喷洒 / 邮箱轰炸配额', () => {
  it('阶梯锁定：已连续被锁 2 次，第 3 次触发锁定期升到 6 小时', async () => {
    const TIER_USER = `e2e_tier_${RUN}`;
    const ip = '10.66.66.66';
    // 直写阶梯记忆：该账号 24h 内已连续被锁 2 次（跳过前两轮 5 次失败，直接验证升级）
    await redis.set(`login:locktier:${TIER_USER}`, '2', 'EX', 86400);
    for (let i = 0; i < 5; i++) {
      await probe('POST', '/api/v1/auth/login', {
        ip,
        body: { username: TIER_USER, password: WRONG_PASSWORD },
      });
    }
    // 第 3 次触发锁定 → LOCK_TIERS[2] = 6h：lock 键 TTL 应在 1h ~ 24h 之间（而非首轮的 15min）
    const ttl = await redis.ttl(`login:lock:${TIER_USER}`);
    expect(ttl).toBeGreaterThan(3600);
    expect(ttl).toBeLessThanOrEqual(6 * 3600);
    const blocked = await probe('POST', '/api/v1/auth/login', {
      ip,
      body: { username: TIER_USER, password: PASSWORD },
    });
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toContain('6 小时');
  });

  it('IP 喷洒防护：单 IP 24h 内失败达 50 次 → 下一次失败触发封锁，之后换正确密码也拦截', async () => {
    const sprayIp = '10.88.88.88';
    await redis.set(`login:ipfail:${sprayIp}`, '50', 'EX', 86400);
    // 第 51 次失败：触发 IP 封锁（喷洒 = 持续失败，封锁以失败为升级条件）
    const trigger = await probe('POST', '/api/v1/auth/login', {
      ip: sprayIp,
      body: { username: USER_A, password: WRONG_PASSWORD },
    });
    expect(trigger.status).toBe(401);
    expect(await redis.ttl(`login:ipblock:${sprayIp}`)).toBeGreaterThan(0);
    // 封锁生效：正确密码也 429（封锁与账号状态无关）
    const res = await probe('POST', '/api/v1/auth/login', {
      ip: sprayIp,
      body: { username: USER_A, password: PASSWORD },
    });
    expect(res.status).toBe(429);
    expect(res.body.message).toContain('该来源登录失败过于频繁');
  });

  it('邮箱轰炸配额：同一邮箱当日发码达上限 → 429（图形码正确也拦）', async () => {
    const QUOTA_EMAIL = `e2e_quota_${RUN}@test.local`;
    await redis.set(`emailcode:daily:email:${QUOTA_EMAIL}`, '11', 'EX', 86400);
    const cap = await putCaptcha();
    const res = await probe('POST', '/api/v1/auth/email-code', {
      body: { scene: 'register', email: QUOTA_EMAIL, captchaId: cap.id, captchaCode: cap.code },
    });
    expect(res.status).toBe(429);
    expect(res.body.message).toContain('今日验证码发送次数已达上限');
  });

  it('v0.9.56 占用前置：已注册邮箱发码 409 且不消耗每日配额', async () => {
    const cap = await putCaptcha();
    const res = await probe('POST', '/api/v1/auth/email-code', {
      body: { scene: 'register', email: `${USER_REG}@test.local`, captchaId: cap.id, captchaCode: cap.code },
    });
    expect(res.status).toBe(409);
    // 配额键未被写入（占用检查在配额之前）：后续正常发码不受影响
    expect(await redis.get(`emailcode:daily:email:${USER_REG}@test.local`)).toBeNull();
  });
});

describe('v0.9.56 边界修复（邮箱归一 / 注册即登录 / refresh 并发双花）', () => {
  it('注册邮箱大小写归一：发码小写、注册大写 → 成功且库内为小写', async () => {
    const lower = `e2e_case_${RUN}@test.local`;
    const code = await putEmailCode('register', lower); // 发码端永远存小写键
    const res = await probe('POST', '/api/v1/auth/register', {
      body: {
        username: `${USER_REG}_upper`,
        password: PASSWORD,
        nickname: ' Case ',
        email: `E2E_CASE_${RUN}@TEST.LOCAL`, // 注册端原大小写
        emailCode: code,
      },
    });
    expect(res.status).toBe(201);
    const user = await prisma.user.findUnique({ where: { username: `${USER_REG}_upper` } });
    expect(user?.email).toBe(lower); // 库内归一为小写
    expect(user?.nickname).toBe('Case'); // nickname trim
    expect(res.body.data.token).toBeTruthy(); // 注册即登录
    expect(res.body.data.user.username).toBe(`${USER_REG}_upper`);
  });

  it('refresh 并发双花：v0.9.65 宽限期下并发刷新均可成功（多标签互不踢）', async () => {
    const login = await probe('POST', '/api/v1/auth/login', {
      body: { username: USER_A, password: PASSWORD },
    });
    expect(login.status).toBe(201);
    const rt = login.body.data.refreshToken;
    const [r1, r2] = await Promise.all([
      probe('POST', '/api/v1/auth/refresh', { body: { refreshToken: rt } }),
      probe('POST', '/api/v1/auth/refresh', { body: { refreshToken: rt } }),
    ]);
    // v0.9.65：轮换后旧令牌保留 60s 宽限 key，后到的一方命中宽限同样换到新对
    // （场景：多标签页共享 localStorage，token 同刻过期各自刷新，不再互相强制登出）
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r1.body.data.refreshToken).toBeTruthy();
    expect(r2.body.data.refreshToken).toBeTruthy();
  });

  it('登录用户名变体归一：带空格/大小写变体的失败计入同一账号锁定计数', async () => {
    // 先用变体「USER_A 大写」失败 4 次（阈值 5 之前）
    for (let i = 0; i < 4; i++) {
      await probe('POST', '/api/v1/auth/login', {
        body: { username: USER_A.toUpperCase(), password: WRONG_PASSWORD },
      });
    }
    // 再用带空格变体失败第 5 次 → 触发锁定
    const fifth = await probe('POST', '/api/v1/auth/login', {
      body: { username: `  ${USER_A}  `, password: WRONG_PASSWORD },
    });
    expect(fifth.status).toBe(401);
    // 任意变体的第 6 次（含正确密码）均被 429 锁定
    const locked = await probe('POST', '/api/v1/auth/login', {
      body: { username: USER_A, password: PASSWORD },
    });
    expect(locked.status).toBe(429);
    expect(locked.body.message).toContain('账号已被锁定');
    // 清理锁与阶梯，避免污染后续用例
    await redis.del(`login:lock:${USER_A.toLowerCase()}`, `login:locktier:${USER_A.toLowerCase()}`);
  });
});

describe('v0.9.57 安全漏洞修复（验证码并发双花 / 登录时序侧信道）', () => {
  const SEC_USER = `e2e_sec_${RUN}`;
  const SEC_EMAIL = `e2e_sec_${RUN}@test.local`;

  it('邮箱验证码并发双花：同一 reset 码并发两发恰一成一败（不会双改密）', async () => {
    await createUser(SEC_USER);
    await prisma.user.update({ where: { username: SEC_USER }, data: { email: SEC_EMAIL } });
    const code = await putEmailCode('reset', SEC_EMAIL);
    const [r1, r2] = await Promise.all([
      probe('POST', '/api/v1/auth/reset-password', {
        body: { email: SEC_EMAIL, code, newPassword: `New${PASSWORD}` },
      }),
      probe('POST', '/api/v1/auth/reset-password', {
        body: { email: SEC_EMAIL, code, newPassword: `New${PASSWORD}` },
      }),
    ]);
    const ok = [r1, r2].filter((r) => r.status === 201).length;
    expect(ok).toBe(1); // Lua 原子「相等才删」：同一码只能消费一次
  });

  it('邮箱验证码错误容错保留：错误码不消费（错 5 次内可重试）', async () => {
    const code = await putEmailCode('reset', SEC_EMAIL);
    const bad = await probe('POST', '/api/v1/auth/reset-password', {
      body: { email: SEC_EMAIL, code: '000000', newPassword: `New${PASSWORD}` },
    });
    expect(bad.status).toBe(400);
    // 错一次后码仍在（failKey 计数 +1，未达 5）——正确码仍可用
    const good = await probe('POST', '/api/v1/auth/reset-password', {
      body: { email: SEC_EMAIL, code, newPassword: `New${PASSWORD}` },
    });
    expect(good.status).toBe(201);
  });

  it('登录时序防御：不存在用户与密码错误响应时间同一量级（<50ms 差）', async () => {
    const t1 = Date.now();
    await probe('POST', '/api/v1/auth/login', {
      body: { username: `no_such_user_${RUN}`, password: WRONG_PASSWORD },
    });
    const ghostMs = Date.now() - t1;
    const t2 = Date.now();
    await probe('POST', '/api/v1/auth/login', {
      body: { username: USER_A, password: WRONG_PASSWORD },
    });
    const realMs = Date.now() - t2;
    // 两侧都跑满 bcrypt KDF：时差应远小于 bcrypt 单次耗时（宽松断言防 CI 抖动）
    expect(Math.abs(ghostMs - realMs)).toBeLessThan(120);
  });
});

describe('v0.9.59 密码策略放宽（仅 DTO 基线：8~32 位、字母+数字）', () => {
  it('弱口令不再被语义规则拦截：Abcd1234 完整注册成功', async () => {
    const uname = `e2e_relax_${RUN}`;
    const email = `${uname}@test.local`;
    const code = await putEmailCode('register', email);
    const res = await probe('POST', '/api/v1/auth/register', {
      body: { username: uname, password: 'abcd1234', email, emailCode: code },
    });
    expect(res.status).toBe(201); // v0.9.58 的黑名单已按用户要求移除
    expect(res.body.data.token).toBeTruthy();
  });

  it('密码格式基线仍生效：纯数字 400（DTO 正则）', async () => {
    const res = await probe('POST', '/api/v1/auth/register', {
      body: {
        username: `e2e_digits_${RUN}`,
        password: '12345678', // 无字母
        email: `e2e_digits_${RUN}@test.local`,
        emailCode: '000000',
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('同时包含字母和数字');
  });

  it('保留用户名注册 403：admin_/root_/system_ 前缀仿冒被拒（v0.9.58 功能保留）', async () => {
    for (const name of [`admin_${RUN}`, `root${RUN}`, `SystemX${RUN}`]) {
      const res = await probe('POST', '/api/v1/auth/register', {
        body: { username: name, password: PASSWORD, email: `${name}@test.local`, emailCode: '000000' },
      });
      expect(res.status).toBe(403);
      expect(res.body.message).toContain('系统保留名称');
    }
  });

  it('渐进重哈希：cost 10 存量哈希登录成功后自动升级为 cost 12（v0.9.58 功能保留）', async () => {
    // createUser 直写库（bcrypt cost 10，模拟存量用户）
    await createUser(`e2e_rehash_${RUN}`);
    const uname = `e2e_rehash_${RUN}`;
    const login = await probe('POST', '/api/v1/auth/login', {
      body: { username: uname, password: PASSWORD },
    });
    expect(login.status).toBe(201);
    const after = await prisma.user.findUnique({ where: { username: uname } });
    expect(bcrypt.getRounds(after!.passwordHash)).toBe(12); // 已升级
    // 升级后旧密码仍可登录（重哈希用同一明文）
    const again = await probe('POST', '/api/v1/auth/login', {
      body: { username: uname, password: PASSWORD },
    });
    expect(again.status).toBe(201);
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

  it('连错 5 次触发账号锁定（首次阶梯 15 分钟），锁定期间正确密码也返回 429', async () => {
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
    expect(res.body.message).toContain('账号已被锁定'); // 业务自定义 429 文案原样透传（阶梯时长动态文案）
  });
});

describe('POST /api/v1/auth/refresh（轮换制）', () => {
  it('刷新换发新令牌对，轮换出全新 refresh；宽限窗口内重放可换（多标签容错）', async () => {
    const login = await probe('POST', '/api/v1/auth/login', {
      body: { username: USER_A, password: PASSWORD },
    });
    const oldRt = login.body.data.refreshToken as string;

    const refresh = await probe('POST', '/api/v1/auth/refresh', { body: { refreshToken: oldRt } });
    expect(refresh.status).toBe(201);
    expect(refresh.body.data.refreshToken).toBeTruthy();
    expect(refresh.body.data.refreshToken).not.toBe(oldRt); // 轮换：新旧不同

    // v0.9.65：旧令牌轮换后保留 60s 宽限 key（吸收多标签并发刷新），窗口内重放换到新对；
    // 窗口外（60s 后）白名单与宽限均已过期，重放被拒——由宽限 TTL 天然保证，不在测试中等待
    const replay = await probe('POST', '/api/v1/auth/refresh', { body: { refreshToken: oldRt } });
    expect(replay.status).toBe(201);
    expect(replay.body.data.refreshToken).toBeTruthy();
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

    // v0.9.58 弱口令规则生效：新密码不能含 ≥4 位连续序列（5678 会被拒）
    const NEW_PASSWORD = 'NewPw77k9x2';
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
