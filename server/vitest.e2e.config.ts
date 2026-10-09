import { defineConfig } from 'vitest/config';

/** 集成测试配置：supertest 起真实应用 + 独立测试库（docker-compose.test.yml） */
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // 集成用例共享测试库与 Redis，禁止并行文件避免互相污染
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // 只升不降：当前 auth 实测 95.69%，每次补测试后手动上调门槛
      thresholds: {
        'src/auth/**': { lines: 80 },
      },
    },
  },
});
