import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dts } from 'rollup-plugin-dts'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(packageRoot, '../..')

/**
 * 合并声明：只从生成 schema 推导并合并所需类型，不人工复制 DTO。
 *
 * 产物中不得残留 `@workspace/*` 包名、源码别名或仓库绝对路径，
 * 因此这里把 workspace 依赖解析到源码后再内联进单文件声明。
 */
export default [
  {
    input: resolve(packageRoot, 'src/index.ts'),
    output: { file: resolve(packageRoot, 'dist/index.d.ts'), format: 'es' },
    plugins: [
      dts({ tsconfig: resolve(packageRoot, 'tsconfig.build.json'), respectExternal: true }),
    ],
    external: [],
  },
  {
    input: resolve(packageRoot, 'src/browser.ts'),
    output: { file: resolve(packageRoot, 'dist/browser.d.ts'), format: 'es' },
    plugins: [
      dts({ tsconfig: resolve(packageRoot, 'tsconfig.build.json'), respectExternal: true }),
    ],
    external: ['cos-js-sdk-v5'],
  },
  {
    input: resolve(packageRoot, 'src/node.ts'),
    output: { file: resolve(packageRoot, 'dist/node.d.ts'), format: 'es' },
    plugins: [
      dts({ tsconfig: resolve(packageRoot, 'tsconfig.build.json'), respectExternal: true }),
    ],
    external: ['cos-nodejs-sdk-v5'],
  },
  {
    input: resolve(packageRoot, 'src/http/browser.ts'),
    output: { file: resolve(packageRoot, 'dist/http-browser.d.ts'), format: 'es' },
    plugins: [
      dts({ tsconfig: resolve(packageRoot, 'tsconfig.build.json'), respectExternal: true }),
    ],
    external: ['axios', '@exre/exui'],
  },
  {
    input: resolve(packageRoot, 'src/http/node.ts'),
    output: { file: resolve(packageRoot, 'dist/http-node.d.ts'), format: 'es' },
    plugins: [
      dts({ tsconfig: resolve(packageRoot, 'tsconfig.build.json'), respectExternal: true }),
    ],
    external: ['axios'],
  },
]

// 声明构建需要能解析 workspace 源码别名，路径在 tsconfig.build.json 中与仓库相对位置一致。
void repositoryRoot
