import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const exist = await prisma.user.findUnique({ where: { username: 'admin' } });
  if (!exist) {
    await prisma.user.create({
      data: {
        id: 'u_admin',
        username: 'admin',
        passwordHash: await bcrypt.hash('admin123', 10),
        nickname: '超级管理员',
        role: 'admin',
        status: 'active',
        department: '技术部',
      },
    });
    console.log('✅ Seeded admin user (admin / admin123)');
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
