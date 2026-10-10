import { execSync } from 'node:child_process';
import { connect } from 'node:net';
import path from 'node:path';

const SERVER_DIR = path.resolve(__dirname, '..');

export const TEST_DATABASE_URL = 'postgresql://kbt:kbt@127.0.0.1:6381/kbt';
export const TEST_REDIS_URL = 'redis://127.0.0.1:6380/0';

/** 轮询等待测试容器端口就绪（docker compose up -d 是异步的） */
function waitPort(port: number, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = connect(port, '127.0.0.1');
      sock.once('connect', () => {
        sock.destroy();
        resolve();
      });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error(`等待端口 ${port} 超时`));
        else setTimeout(tryOnce, 500);
      });
    };
    tryOnce();
  });
}

export async function setup() {
  // 幂等：容器已在跑则直接复用（编排文件与 server 同目录，本机/CI 路径一致）
  execSync('docker compose -f docker-compose.test.yml up -d', { cwd: SERVER_DIR, stdio: 'inherit' });
  await Promise.all([waitPort(6381), waitPort(6380), waitPort(6390)]);
  // 独立测试库跑迁移（绝不触碰 server/.env 指向的库）
  execSync('npx prisma migrate deploy', {
    cwd: SERVER_DIR,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
}
