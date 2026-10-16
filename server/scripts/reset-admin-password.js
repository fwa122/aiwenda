// 临时脚本：重置 admin 密码为 .env 中的 ADMIN_INITIAL_PASSWORD（本地 dev 用）
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { requiredEnv } = require('./lib.env');

const prisma = new PrismaClient();

async function main() {
  const password = requiredEnv('ADMIN_INITIAL_PASSWORD');
  const hash = bcrypt.hashSync(password, 10);
  const user = await prisma.user.update({
    where: { username: 'admin' },
    data: { passwordHash: hash, tokenVersion: { increment: 1 } },
  });
  console.log('OK', user.username, user.role);
}

main()
  .catch((e) => {
    console.error('ERR', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
