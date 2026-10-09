import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    // vitest 复用本配置（含 @ 别名）；markdown 渲染与 SSE 需要浏览器 API，用 jsdom
    environment: 'jsdom',
    include: ['src/**/*.spec.js']
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    open: false,
    proxy: {
      // 后端联调时启用：把 /api 代理到 Node BFF 服务（默认 3000 端口）
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500
  }
})
