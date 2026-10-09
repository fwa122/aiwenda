import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
