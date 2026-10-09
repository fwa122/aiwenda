import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // 只升不降：common 含未测的 log 等文件，真实基线 36.5%；
      // 每补一块测试手动上调门槛
      thresholds: {
        'src/common/**': { lines: 35 },
      },
    },
  },
});
