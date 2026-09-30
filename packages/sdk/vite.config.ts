import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(packageRoot, '../..')

/**
 * 浏览器与 Node 两套 ESM 产物。
 *
 * api-client 与 openapi-fetch 源码被打包进 SDK（外部产物不要求安装私有 workspace 包）；
 * COS 运行库按环境保持外部依赖，因此浏览器产物不会带入 Node 专用实现。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@api-client': resolve(repositoryRoot, 'packages/api-client'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    target: 'es2022',
    lib: {
      entry: {
        browser: resolve(packageRoot, 'src/browser.ts'),
        node: resolve(packageRoot, 'src/node.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['cos-js-sdk-v5', 'cos-nodejs-sdk-v5'],
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
})
