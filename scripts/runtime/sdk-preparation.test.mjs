import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { root } from './shared.mjs'
import { prepareSdk, sdkPreparationSpecifications } from './sdk-preparation.mjs'
import { typecheckSpecifications, main as typecheck } from './typecheck.mjs'
import { runTests, watchTests, isTestSourceChange, testSpecifications } from './tests.mjs'
import { isSdkSourceChange, watchSdkSources } from './sdk-watch.mjs'
import { main as server, serverSpecification } from './server.mjs'
import { specifications } from './local-dev.mjs'
import { operatingEnvironment } from './settings.mjs'

const tools = { node: process.execPath, corepack: join(root, 'fake-corepack.js') }
const options = { workspace: root, tools, inherited: { DATABASE_URL: 'secret', AUTH_CODE_HMAC_KEY: 'secret', NODE_OPTIONS: '--inspect' } }

test('SDK preparation serially generates Contract then builds only SDK with a restricted environment', async () => {
  const specs = sdkPreparationSpecifications(options), calls = [], controller = new AbortController()
  assert.deepEqual(specs.map(spec => spec.name), ['API Contract', '@workspace/sdk'])
  assert.deepEqual(specs[0].args, [join(root, 'scripts/api/generate.mjs'), 'generate'])
  assert.deepEqual(specs[1].args, [tools.corepack, 'pnpm', '--filter', '@workspace/sdk', 'build'])
  assert.ok(specs.every(spec => !spec.environment.DATABASE_URL && !spec.environment.AUTH_CODE_HMAC_KEY && !spec.environment.NODE_OPTIONS))
  await prepareSdk({ ...options, signal: controller.signal, execute: async (spec, received) => {
    assert.equal(received.signal, controller.signal); calls.push(spec.name)
  } })
  assert.deepEqual(calls, ['API Contract', '@workspace/sdk'])
})

test('preparation failure or cancellation prevents SDK consumers and later stages', async () => {
  for (const stage of ['API Contract', '@workspace/sdk']) {
    const calls = []
    await assert.rejects(prepareSdk({ ...options, execute: async spec => { calls.push(spec.name); if (spec.name === stage) throw new Error(stage) } }), new RegExp(stage))
    assert.equal(calls.at(-1), stage)
    let consumed = false
    await assert.rejects(typecheck(options, async () => { consumed = true }, async () => { throw new Error('prepare failed') }), /prepare failed/)
    assert.equal(consumed, false)
  }
  const controller = new AbortController(), calls = []
  await assert.rejects(prepareSdk({ ...options, signal: controller.signal, execute: async spec => { calls.push(spec.name); controller.abort() } }))
  assert.deepEqual(calls, ['API Contract'])
})

test('typecheck and each test pass prepare SDK before consumers without building applications', async () => {
  const calls = []
  await typecheck(options, async spec => calls.push(spec.name), async received => {
    assert.equal(received.workspace, root); calls.push('prepare')
  })
  assert.deepEqual(calls, ['prepare', ...typecheckSpecifications(options).map(spec => spec.name)])
  assert.deepEqual(typecheckSpecifications(options).map(spec => spec.args), [
    [tools.corepack, 'pnpm', '-r', 'typecheck'],
    [tools.corepack, 'pnpm', 'exec', 'tsc', '--noEmit', '-p', 'tests/sdk/types/tsconfig.json'],
    [tools.corepack, 'pnpm', 'exec', 'tsc', '--noEmit', '-p', 'tests/server-types/tsconfig.json'],
  ])
  calls.length = 0
  for (let pass = 0; pass < 2; pass++) await runTests(options, async spec => calls.push(spec.name), async () => calls.push('prepare'))
  assert.deepEqual(calls, ['prepare', 'Website', 'runtime', 'prepare', 'Website', 'runtime'])
  assert.ok(testSpecifications(options)[1].args.includes('scripts/runtime/sdk-preparation.test.mjs'))
  assert.ok(testSpecifications(options)[1].args.includes('scripts/runtime/dev-rebuild.test.mjs'))
})

test('SDK and test watchers reject generated directory creation, outputs, temporaries and logs', () => {
  for (const [directory, path] of [
    ['api', 'generated'], ['api', 'generated/openapi.json'], ['packages/sdk', 'src/generated'],
    ['packages/sdk', 'src/generated/schema.d.ts.random.tmp'], ['packages/sdk', 'dist'],
    ['packages/sdk', 'dist/node.js'], ['packages/sdk', 'node_modules'], ['packages/sdk', '.dts-temp/index.d.ts'],
    ['packages/sdk', 'build/tmp'], ['packages/sdk', 'src/index.ts.random.tmp'], ['packages/sdk', 'build.log'],
  ]) {
    assert.equal(isSdkSourceChange(directory, path), false, `${directory}/${path}`)
    assert.equal(isTestSourceChange(directory, path), false, `${directory}/${path}`)
  }
  for (const [directory, path] of [['api', 'paths/auth.yaml'], ['packages/sdk', 'src\\http\\core.ts'],
    ['packages/sdk', 'package.json'], ['packages/sdk', 'tsconfig.build.json'], ['packages/sdk', 'vite.config.ts'], ['packages/sdk', 'rollup.config.dts.mjs']])
    assert.equal(isSdkSourceChange(directory, path), true, `${directory}/${path}`)
  assert.equal(isSdkSourceChange('apps/web/src', 'main.tsx'), false)
})

test('SDK watcher forwards source events and closes every watcher after a partial setup failure', () => {
  const watches = [], changed = [], closed = []
  const watchDirectory = (directory, _options, callback) => {
    const watcher = { on() {}, close() { closed.push(directory) } }
    watches.push({ directory, callback }); return watcher
  }
  const watcher = watchSdkSources(root, () => changed.push('source'), { watchDirectory })
  watches[0].callback('rename', 'generated'); watches[1].callback('rename', 'dist'); watches[1].callback('change', 'src/index.ts')
  assert.deepEqual(changed, ['source']); watcher.close(); assert.equal(closed.length, 2)
  let call = 0
  assert.throws(() => watchSdkSources(root, () => {}, { watchDirectory: (...args) => {
    if (++call === 2) throw new Error('watch failed'); return watchDirectory(...args)
  } }), /watch failed/)
  assert.equal(closed.length, 3)
})

test('SDK watcher attempts every close even when one watcher fails to close', () => {
  let calls = 0, closes = 0
  const watcher = watchSdkSources(root, () => {}, { watchDirectory() {
    const current = ++calls
    return { on() {}, close() { closes++; if (current === 1) throw new Error('close failed') } }
  } })
  assert.throws(() => watcher.close()); assert.equal(closes, 2)
})

test('test watch coalesces changes, waits after failure and ignores its own preparation outputs', async () => {
  const controller = new AbortController(), watches = new Map(), closed = [], previousExit = process.exitCode
  let calls = 0, finish
  const running = watchTests({ workspace: root, signal: controller.signal }, async () => {
    calls++
    if (calls === 1) await new Promise(resolve => { finish = resolve })
    else if (calls === 2) throw new Error('fixture failure')
  }, { watchDirectory(directory, _options, callback) {
    watches.set(directory, callback); return { on() {}, close() { closed.push(directory) } }
  } })
  try {
    while (!finish) await delay(5)
    watches.get(join(root, 'api'))('rename', 'generated')
    watches.get(join(root, 'packages/sdk'))('change', 'src/generated/schema.d.ts')
    watches.get(join(root, 'packages/sdk'))('change', 'src/index.ts')
    watches.get(join(root, 'packages/sdk'))('change', 'package.json')
    finish()
    for (let i = 0; calls < 2 && i < 100; i++) await delay(5)
    await delay(25); assert.equal(calls, 2)
    watches.get(join(root, 'packages/sdk'))('change', 'dist/index.d.ts')
    await delay(25); assert.equal(calls, 2)
    watches.get(join(root, 'packages/sdk'))('change', 'src/index.ts')
    for (let i = 0; calls < 3 && i < 100; i++) await delay(5)
    assert.equal(calls, 3)
  } finally { controller.abort(); await running; process.exitCode = previousExit }
  assert.equal(closed.length, watches.size)
})

test('standalone Server dev prepares first; production start never prepares and root uses the direct Node specification', async () => {
  const environment = { RUNTIME_ENV_INJECTED: 'true', NODE_ENV: 'production' }, calls = []
  const dependencies = { workspace: root, inherited: environment, execute: async spec => calls.push(spec.args), prepare: async () => calls.push('prepare') }
  await server('dev', [], dependencies)
  assert.equal(calls[0], 'prepare'); assert.deepEqual(calls[1], ['--import', 'tsx', '--watch', 'src/server.ts'])
  calls.length = 0; await server('start', [], dependencies)
  assert.deepEqual(calls, [['dist/server.js']])
  const state = { workspace: root, environments: { server: environment, web: {} } }
  assert.deepEqual(specifications(state, tools)[0].args, serverSpecification('dev', [], { workspace: root, inherited: environment }).args)
})

test('real maintenance entry preserves JSON, usable URLs, separate stderr and exact exit codes', t => {
  const workspace = mkdtempSync(join(tmpdir(), 'server-cli-output-'))
  t.after(() => rmSync(workspace, { recursive: true, force: true }))
  const directory = join(workspace, 'apps/server/dist/cli')
  mkdirSync(directory, { recursive: true })
  const expected = { ssoRequestId: 'fixture-request', url: 'http://localhost:8081/login?ssoRequestId=fixture-request', label: 'fixture 中文' }
  const stdout = `${JSON.stringify(expected)}\n`, stderr = 'fixture diagnostic: http://localhost:8081/diagnostics\n'
  for (const code of [0, 7]) {
    writeFileSync(join(directory, 'sso-create.js'), `process.stdout.write(${JSON.stringify(stdout)});process.stderr.write(${JSON.stringify(stderr)});process.exitCode=${code};`)
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { main } from ${JSON.stringify(pathToFileURL(join(root, 'scripts/runtime/server.mjs')).href)};
      await main('sso:create', [], { workspace: ${JSON.stringify(workspace)}, inherited: { RUNTIME_ENV_INJECTED: 'true', NODE_ENV: 'production' } });
    `], { cwd: root, env: operatingEnvironment(), encoding: 'utf8', windowsHide: true, shell: false, timeout: 30000 })
    assert.equal(result.error, undefined)
    assert.equal(result.stdout, stdout)
    assert.deepEqual(JSON.parse(result.stdout), expected)
    assert.equal(result.stderr, stderr)
    assert.equal(result.status, code)
  }
})
