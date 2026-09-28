import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Mock Server 的本地地址。
 * 与 `apps/mock-server/src/server.ts` 的监听地址保持一致，并显式使用 127.0.0.1，
 * 避免在 Windows 上因 `localhost` 解析到 IPv6 而代理不到只绑定 IPv4 的服务。
 */
const MOCK_SERVER_ORIGIN = 'http://127.0.0.1:8080'

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@web': resolve(repositoryRoot, 'apps/web'),
      '@server': resolve(repositoryRoot, 'apps/mock-server'),
      '@api-client': resolve(repositoryRoot, 'packages/api-client'),
      '@components': resolve(repositoryRoot, 'packages/components'),
      '@tests': resolve(repositoryRoot, 'tests'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 8081,
    strictPort: true,
    // Vite 注入的开发脚本早于 HTML meta，响应头必须先保护邀请 URL。
    headers: { 'Referrer-Policy': 'no-referrer' },
    proxy: {
      // 原样转发 `/api/*`：Mock Server 自己注册 `/api` 前缀，因此这里不做 rewrite。
      '/api': {
        target: MOCK_SERVER_ORIGIN,
      },
    },
  },
})
