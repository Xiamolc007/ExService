import { watch } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runOwned, signalScope } from '../docs-integration/ownership.mjs'
import { operatingEnvironment, environmentFile, withNodePath } from './settings.mjs'
import { isolatedEnvironment } from '../docs-integration/test-outline.mjs'
import { root } from './shared.mjs'
import { outlineServerTests, outlineFrontendTests } from './test-manifest.mjs'
import { reporter, RuntimeError } from './output.mjs'
import { generateContract } from '../api/generate.mjs'

export function testSpecifications({ workspace = root, inherited = process.env } = {}) {
  const configured = environmentFile(join(workspace, '.env.local'))
  const node = inherited.INTEGRATION_NODE_BIN ?? configured.INTEGRATION_NODE_BIN ?? process.execPath
  const corepack = inherited.INTEGRATION_COREPACK_JS ?? configured.INTEGRATION_COREPACK_JS ?? join(dirname(process.execPath), 'node_modules/corepack/dist/corepack.js')
  const environment = withNodePath(operatingEnvironment(inherited), node)
  const logic = ['scripts/api/generate.test.mjs', 'scripts/runtime/settings.test.mjs', 'scripts/runtime/output.test.mjs', 'scripts/runtime/deployment.test.mjs', 'scripts/runtime/application-lock.test.mjs',
    'scripts/docs-integration/ownership.test.mjs', 'scripts/docs-integration/readiness.test.mjs',
    'scripts/docs-integration/test-outline.test.mjs', 'scripts/docs-integration/hydra-client.test.mjs']
  const outlineEnv = isolatedEnvironment(environment, { databaseUrl: 'postgres://isolated:isolated@127.0.0.1:1/outline-test',
    redisUrl: 'redis://127.0.0.1:1', storage: join(workspace, '.local/runtime/frontend-test-storage'), node })
  return [
    // Bound disposable database and CPU concurrency to reduce contention
    // between transport timing scenarios and the database suite.
    { name: 'Website', command: node, cwd: workspace, args: [corepack, 'pnpm', 'exec', 'vitest', 'run', '--maxWorkers', '2'], environment },
    { name: 'runtime / Docs 脚本', command: node, cwd: workspace, args: ['--test', '--test-name-pattern', '^(?!registers the separate fixed probe client)', ...logic], environment },
    ...['app', 'shared-node', 'shared-jsdom'].map(project => ({ name: `Outline frontend ${project}`, command: node, cwd: join(workspace, 'apps/outline'),
      args: [corepack, 'yarn', 'vitest', 'run', ...outlineFrontendTests.filter(file => project === 'app' ? file.startsWith('app/') :
        project === 'shared-jsdom' ? file.startsWith('shared/editor/') : file.startsWith('shared/') && !file.startsWith('shared/editor/')),
      '--project', project, '--dangerouslyIgnoreUnhandledErrors=false'], environment: outlineEnv })),
    ...outlineServerTests.map(selection => ({ name: `Outline ${selection.file}`, command: node, cwd: workspace,
      args: [join(workspace, 'scripts/docs-integration/test-outline.mjs'), ...(selection.databaseName ? ['--database-name', selection.databaseName] : []), selection.file, ...selection.cases],
      environment: { ...environment, INTEGRATION_NODE_BIN: node, INTEGRATION_COREPACK_JS: corepack } })),
  ]
}

export async function runTests(options = {}, execute = runOwned, generate = generateContract) {
  const output = reporter({ verbose: options.verbose })
  output.title('自动验证：Website → runtime/Docs 脚本 → 定制 Outline；不执行 Build 或真实开发生命周期')
  const scope = signalScope()
  try {
    scope.check()
    await output.stage('API Contract', () => generate({ workspace: options.workspace ?? root }))
    for (const spec of testSpecifications(options)) {
      scope.check()
      await output.stage(spec.name, onLog => execute(spec, { onLog, signal: scope.signal }))
    }
  } finally { scope.close() }
}

/** Generated files, including publication temporaries, must never queue another pass. */
export function isTestSourceChange(directory, path) {
  if (!path) return false
  const file = `${directory}/${path}`.replaceAll('\\', '/')
  return !/(?:^|\/)(?:node_modules|dist|\.source)(?:\/|$)/.test(file) &&
    (!/(?:^|\/)build(?:\/|$)/.test(file) || file.startsWith('apps/web/build/')) &&
    !file.endsWith('.log') && !file.startsWith('api/generated/') &&
    !file.startsWith('packages/api-client/src/generated/')
}

/** Changes queue another complete pass; runs never overlap or inherit a development database. */
export async function watchTests(options = {}, execute = runTests) {
  const workspace = options.workspace ?? root, scope = signalScope(), watchers = []
  let pending = true, wake
  const directories = ['api', 'tests', 'scripts', 'apps/web/src', 'apps/server/src', 'packages/api-client/src', 'packages/components/src', 'packages/sdk/src',
    'apps/web/content', 'apps/web/build', 'apps/web/source.config.ts',
    'apps/outline/server/identity', 'apps/outline/server/routes/auth', 'apps/outline/app', 'apps/outline/shared']
  try {
    for (const directory of directories) watchers.push(watch(join(workspace, directory), { recursive: true }, (_, path) => {
      if (isTestSourceChange(directory, path)) { pending = true; wake?.() }
    }))
    while (!scope.signal.aborted) {
      if (pending) {
        pending = false
        try { await execute(options); process.exitCode = 0 } catch { console.error('本轮自动验证失败；监听下一次修改。'); process.exitCode = 1 }
      } else await new Promise(resolve => {
        const done = () => { scope.signal.removeEventListener('abort', done); wake = undefined; resolve() }
        wake = done; scope.signal.addEventListener('abort', done, { once: true })
        if (scope.signal.aborted || pending) done()
      })
    }
  } finally { watchers.forEach(watcher => watcher.close()); scope.close() }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    if (args.some(value => !['--watch', '--verbose'].includes(value)) || new Set(args).size !== args.length) throw new RuntimeError('TEST_ARGUMENTS_INVALID')
    await (args.includes('--watch') ? watchTests : runTests)({ verbose: args.includes('--verbose') })
  } catch { console.error('自动验证失败；检查上方分组和用例日志。'); process.exitCode = 1 }
}
