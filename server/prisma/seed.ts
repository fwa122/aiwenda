import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * 测试员工种子数据（仅用于开发/演示环境验证部门维度看板与多用户协作）：
 * - 必须显式设置 SEED_TEST_USERS=true 才会播种，生产环境默认关闭，避免测试账号混入
 * - 密码复用 SEED_TEST_PASSWORD（未配置则回落 ADMIN_INITIAL_PASSWORD），杜绝硬编码弱口令
 * - 幂等：按 username 查重，已存在则跳过，可安全重跑
 */
const TEST_USERS = [
  { id: 'u_seed_zhang', username: 'zhangsan', nickname: '张伟', role: 'editor', department: '研发部' },
  { id: 'u_seed_li', username: 'lisi', nickname: '李娜', role: 'viewer', department: '研发部' },
  { id: 'u_seed_wang', username: 'wangwu', nickname: '王芳', role: 'editor', department: '市场部' },
  { id: 'u_seed_zhao', username: 'zhaoliu', nickname: '赵敏', role: 'viewer', department: '市场部' },
  { id: 'u_seed_sun', username: 'sunqi', nickname: '孙倩', role: 'viewer', department: '人事部' },
  { id: 'u_seed_zhou', username: 'zhouba', nickname: '周杰', role: 'editor', department: '财务部' },
  { id: 'u_seed_wu', username: 'wujiu', nickname: '吴久', role: 'viewer', department: '' },
];

async function main() {
  const exist = await prisma.user.findUnique({ where: { username: 'admin' } });
  if (!exist) {
    // 初始密码必须由环境变量注入（fail-fast：未配置则跳过播种），杜绝硬编码弱口令
    const adminPassword = process.env.ADMIN_INITIAL_PASSWORD;
    if (!adminPassword) {
      console.warn('⚠️  ADMIN_INITIAL_PASSWORD 未配置，已跳过 admin 播种（请在 .env 配置后重跑 seed）');
    } else {
      await prisma.user.create({
        data: {
          id: 'u_admin',
          username: 'admin',
          passwordHash: await bcrypt.hash(adminPassword, 10),
          nickname: '超级管理员',
          role: 'admin',
          status: 'active',
          department: '技术部',
        },
      });
      console.log('✅ Seeded admin user（密码来自 ADMIN_INITIAL_PASSWORD，日志不落明文）');
    }
  } else {
    console.log('ℹ️  admin already exists, skipped');
  }

  // ---------- 测试员工（SEED_TEST_USERS=true 时才播种） ----------
  if (process.env.SEED_TEST_USERS !== 'true') {
    console.log('ℹ️  SEED_TEST_USERS != true, skipped test users');
    return;
  }
  const testPassword = process.env.SEED_TEST_PASSWORD || process.env.ADMIN_INITIAL_PASSWORD;
  if (!testPassword) {
    console.warn('⚠️  SEED_TEST_PASSWORD / ADMIN_INITIAL_PASSWORD 均未配置，已跳过测试员工播种');
    return;
  }

  const passwordHash = await bcrypt.hash(testPassword, 10);
  let created = 0;
  for (const u of TEST_USERS) {
    const dup = await prisma.user.findUnique({ where: { username: u.username } });
    if (dup) {
      console.log(`ℹ️  ${u.username} already exists, skipped`);
      continue;
    }
    await prisma.user.create({
      data: {
        id: u.id,
        username: u.username,
        passwordHash,
        nickname: u.nickname,
        role: u.role,
        // 空字符串部门：验证看板「未设置」归组逻辑
        department: u.department || null,
        status: 'active',
      },
    });
    created += 1;
  }
  console.log(`✅ Seeded ${created} test users（覆盖 研发/市场/人事/财务 + 未设置 共 5 个部门分组）`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
