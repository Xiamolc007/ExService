import { defineConfig } from 'vitest/config'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = dirname(fileURLToPath(import.meta.url))
const webNodeModules = resolve(repositoryRoot, 'apps/web/node_modules')

export default defineConfig({
  resolve: {
    // 本地 @exre/exui link 可能带着自己的 React；测试与浏览器一样必须共享单一实例。
    dedupe: ['react', 'react-dom'],
    alias: [
      { find: /^react$/, replacement: resolve(webNodeModules, 'react/index.js') },
      { find: /^react\/jsx-runtime$/, replacement: resolve(webNodeModules, 'react/jsx-runtime.js') },
      { find: /^react\/jsx-dev-runtime$/, replacement: resolve(webNodeModules, 'react/jsx-dev-runtime.js') },
      { find: /^react-dom$/, replacement: resolve(webNodeModules, 'react-dom/index.js') },
      { find: /^react-dom\/(.*)$/, replacement: resolve(webNodeModules, 'react-dom/$1') },
    ],
  },
  test: {
    environment: 'node',
  },
})
