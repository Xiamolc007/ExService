import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { lookup } from 'node:dns/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { configure, localRoot, root } from './configure.mjs'
import { ensureHydraClient } from './hydra-client.mjs'

const command = process.argv[2]
const modePath = join(localRoot, 'mode.json')
const initializedPath = join(localRoot, 'initialized.json')
const stopRequestPath = join(localRoot, 'stop-request.json')
const files = ['-f', 'compose.yaml']
const overlays = { full: [...files, '-f', 'compose.full.yaml'], dev: [...files, '-f', 'compose.dev.yaml'] }

function envPath(mode) { return join(localRoot, `${mode}.env`) }
function compose(mode, args, environment = {}) {
  const result = spawnSync('docker', ['compose', '--env-file', envPath(mode), ...overlays[mode], ...args], {
    cwd: root, stdio: 'inherit', shell: false, env: { ...process.env, ...environment },
  })
  if (result.status !== 0) throw new Error(`Docker Compose ${args[0]} 失败。`)
}
function composeOutput(mode, args) {
  const result = spawnSync('docker', ['compose', '--env-file', envPath(mode), ...overlays[mode], ...args], {
    cwd: root, encoding: 'utf8', shell: false,
  })
  if (result.status !== 0) throw new Error('无法检查现有集成容器。')
  return result.stdout.trim()
}
function configured() {
  if (!existsSync(envPath('full')) || !existsSync(envPath('dev'))) {
    throw new Error('先运行 pnpm integration:configure。')
  }
}
async function assertHosts() {
  for (const host of ['exwebsite.test', 'identity.exwebsite.test']) {
    const result = await lookup(host, { family: 4 })
    if (result.address !== '127.0.0.1') {
      throw new Error(`请先将 ${host} 映射到 127.0.0.1，再启动集成环境。`)
    }
  }
}
function assertMode(next) {
  if (!existsSync(modePath)) return
  const prior = JSON.parse(readFileSync(modePath, 'utf8'))
  const running = prior.mode === next ? '' : composeOutput(prior.mode, ['ps', '--status', 'running', '--services'])
  assertModeAvailable(prior, next, running, hostModeAlive(prior))
}
function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

function hostModeAlive(prior) {
  return prior.mode === 'dev' && (processAlive(prior.supervisorPid) ||
    (Array.isArray(prior.children) && prior.children.some(processAlive)))
}

/** Refuses conflicting live modes while allowing recovery from stale records. */
export function assertModeAvailable(prior, next, runningServices, hostAlive) {
  if (hostAlive || (prior.mode !== next && runningServices)) {
    throw new Error(`当前 ${prior.mode} 模式仍在运行；先执行 pnpm integration:down。`)
  }
}

function saveMode(mode, extra = {}) {
  writeFileSync(modePath, JSON.stringify({ mode, startedAt: new Date().toISOString(), ...extra }))
}
function requireInitialized() {
  if (!existsSync(initializedPath)) throw new Error('先显式运行 pnpm integration:init。')
}
function parseEnv(mode) {
  return Object.fromEntries(readFileSync(envPath(mode), 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
    const index = line.indexOf('=')
    return [line.slice(0, index), line.slice(index + 1)]
  }))
}

function hostPort(value) {
  const match = /^host\.docker\.internal:([1-9]\d{0,4})$/.exec(value ?? '')
  if (!match || Number(match[1]) > 65535) throw new Error('开发 upstream 必须包含有效的宿主机端口。')
  return match[1]
}

/** Builds host launch specifications from the same configuration as the gateway. */
export function devProcesses(values, options = {}) {
  const workspace = options.root ?? root
  const local = options.localRoot ?? localRoot
  const node = options.node ?? process.execPath
  const environment = options.environment ?? process.env
  const serverPort = hostPort(values.WEBSITE_SERVER_UPSTREAM)
  const webPort = hostPort(values.WEBSITE_WEB_UPSTREAM)
  const outlinePort = hostPort(values.OUTLINE_BACKEND_UPSTREAM)
  const outlineVitePort = hostPort(values.OUTLINE_STATIC_UPSTREAM)
  const common = { ...environment,
    PATH: `${dirname(node)}${process.platform === 'win32' ? ';' : ':'}${environment.PATH ?? ''}`,
    WEBSITE_INTEGRATION_ENABLED: 'true' }
  return [
    { name: 'exui', cwd: values.EXUI_SOURCE_DIR,
      args: ['pnpm', 'exec', 'node', join(workspace, 'scripts', 'docs-integration', 'watch-exui.mjs')], environment: common },
    { name: 'server', cwd: workspace, args: ['pnpm', '--filter', '@workspace/server', 'dev'], environment: {
      ...common, DATABASE_URL: `postgres://exre:${values.EXRE_PASSWORD}@127.0.0.1:16432/exre`,
      AUTH_CODE_HMAC_KEY: values.AUTH_CODE_HMAC_KEY, SERVER_PUBLIC_WEB_BASE_URL: 'http://exwebsite.test:8090',
      SERVER_PUBLIC_AVATAR_BASE_URL: 'http://exwebsite.test:8090/api/avatars',
      SERVER_AVATAR_DIRECTORY: join(local, 'data', 'avatars'), SERVER_HOST: '0.0.0.0', SERVER_PORT: serverPort,
      OUTLINE_INTEGRATION_KEY: values.OUTLINE_INTEGRATION_KEY, IDENTITY_BOOTSTRAP_KEY: values.IDENTITY_BOOTSTRAP_KEY,
      IDENTITY_DELIVERY_KEY: values.IDENTITY_DELIVERY_KEY, IDENTITY_FLOW_KEY: values.IDENTITY_FLOW_KEY,
      HYDRA_ADMIN_URL: 'http://127.0.0.1:14445',
      OUTLINE_INTERNAL_URL: `http://127.0.0.1:${outlinePort}`,
    } },
    { name: 'web', cwd: workspace, args: ['pnpm', '--filter', '@workspace/web', 'dev'], environment: {
      ...common, INTEGRATION_SERVER_PORT: serverPort, INTEGRATION_WEB_PORT: webPort,
    } },
    { name: 'outline', cwd: join(workspace, 'apps', 'outline'), args: ['yarn', 'dev:watch:integration'], environment: {
      ...common, NODE_ENV: 'development', URL: 'http://exwebsite.test:8090/docs', PORT: outlinePort,
      INTEGRATION_OUTLINE_VITE_PORT: outlineVitePort, SECRET_KEY: values.OUTLINE_SECRET_KEY,
      UTILS_SECRET: values.OUTLINE_UTILS_SECRET,
      DATABASE_URL: `postgres://outline:${values.OUTLINE_PASSWORD}@127.0.0.1:16432/outline`,
      PGSSLMODE: 'disable', REDIS_URL: 'redis://127.0.0.1:16379', FILE_STORAGE: 'local',
      FILE_STORAGE_LOCAL_ROOT_DIR: join(local, 'data', 'outline'), FORCE_HTTPS: 'false',
      OUTLINE_INTEGRATION_KEY: values.OUTLINE_INTEGRATION_KEY, IDENTITY_DELIVERY_KEY: values.IDENTITY_DELIVERY_KEY,
      OUTLINE_OIDC_CLIENT_SECRET: values.OUTLINE_OIDC_CLIENT_SECRET,
      OUTLINE_OIDC_CLIENT_ID: 'ex-outline', HYDRA_PUBLIC_URL: 'http://identity.exwebsite.test:8090/',
      WEBSITE_INTERNAL_URL: `http://127.0.0.1:${serverPort}`,
    } },
  ]
}
function spawnHost(node, corepack, cwd, args, environment) {
  const child = spawn(node, [corepack, ...args], {
    cwd, env: { ...environment, INTEGRATION_COREPACK_JS: corepack }, stdio: 'inherit', shell: false, detached: process.platform !== 'win32',
  })
  child.once('exit', code => {
    if (code !== 0) console.error(`${args.join(' ')} 已退出：${code}`)
  })
  return child
}

/** Stops only owned child handles, including the watchers they spawned. */
export function stopHostProcesses(children) {
  for (const child of children) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue
    if (process.platform === 'win32') {
      const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', shell: false })
      if (result.status !== 0 && processAlive(child.pid)) throw new Error('无法停止本次启动的应用进程。')
    } else {
      try { process.kill(-child.pid, 'SIGTERM') } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
  }
}

async function requestHostStop(prior) {
  if (!hostModeAlive(prior)) return
  if (!processAlive(prior.supervisorPid)) {
    throw new Error('开发监督进程已退出但应用进程仍存在；请核对原启动终端，不能按旧 PID 强制清理。')
  }
  if (typeof prior.runId !== 'string') throw new Error('旧的开发进程记录缺少身份；请在原启动终端停止。')
  writeFileSync(stopRequestPath, JSON.stringify({ runId: prior.runId }))
  for (let count = 0; count < 200; count++) {
    const current = JSON.parse(readFileSync(modePath, 'utf8'))
    if (current.runId === prior.runId && current.stoppedAt) return
    if (!processAlive(prior.supervisorPid)) return
    await delay(100)
  }
  throw new Error('开发模式尚未响应停止请求；请在原启动终端停止，不强制结束其他进程。')
}
async function runDev() {
  configured()
  requireInitialized()
  await assertHosts()
  assertMode('dev')
  const values = parseEnv('dev')
  const node = process.env.INTEGRATION_NODE_BIN || join(localRoot, 'tools', 'node26', 'node-v26.3.0-win-x64', 'node.exe')
  const corepack = process.env.INTEGRATION_COREPACK_JS || join(dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js')
  if (!existsSync(node) || !existsSync(corepack)) {
    throw new Error('开发模式需要本机 Node 26 和 Corepack；设置 INTEGRATION_NODE_BIN / INTEGRATION_COREPACK_JS。')
  }
  const version = spawnSync(node, ['--version'], { encoding: 'utf8', shell: false })
  if (version.status !== 0 || version.stdout.trim() !== 'v26.3.0') throw new Error('开发模式要求已选定的 Node 26.3.0。')
  const specifications = devProcesses(values, { node })
  compose('dev', ['up', '-d', 'postgres', 'redis', 'hydra', 'gateway'])
  const runId = randomUUID()
  const children = specifications.map(item => spawnHost(node, corepack, item.cwd, item.args, item.environment))
  saveMode('dev', { supervisorPid: process.pid, runId, children: children.map(child => child.pid) })
  let resolveStop
  const requestedStop = new Promise(resolve => { resolveStop = resolve })
  const stop = () => resolveStop()
  const poll = setInterval(() => {
    if (!existsSync(stopRequestPath)) return
    try {
      if (JSON.parse(readFileSync(stopRequestPath, 'utf8')).runId === runId) stop()
    } catch { /* Ignore an incomplete request write and check again. */ }
  }, 100)
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  try {
    await Promise.race([requestedStop, ...children.map(child => new Promise((resolve, reject) => {
      child.once('exit', () => reject(new Error('集成开发应用意外退出。')))
      child.once('error', () => reject(new Error('无法启动集成开发应用。')))
    }))])
  } finally {
    clearInterval(poll)
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
    stopHostProcesses(children)
    writeFileSync(modePath, JSON.stringify({ mode: 'dev', runId, stoppedAt: new Date().toISOString() }))
  }
}

async function runBootstrap() {
  configured()
  requireInitialized()
  await assertHosts()
  const args = process.argv.slice(3)
  if (args[0] === '--') args.shift()
  if (args.length !== 2 || args[0] !== '--admin-user-id' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args[1])) {
    throw new Error('用法：pnpm integration:bootstrap -- --admin-user-id <Website UUID>')
  }
  const prior = existsSync(modePath) ? JSON.parse(readFileSync(modePath, 'utf8')) : undefined
  if (!prior || prior.stoppedAt || !['dev', 'full'].includes(prior.mode)) throw new Error('先启动集成运行模式，再显式初始化工作区。')
  const values = parseEnv(prior.mode)
  if (prior.mode === 'dev') {
    const inspect = await fetch(`http://127.0.0.1:${hostPort(values.WEBSITE_SERVER_UPSTREAM)}/api/internal/identity/user/inspect`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bootstrap-Key': values.IDENTITY_BOOTSTRAP_KEY },
      body: JSON.stringify({ userId: args[1] }), signal: AbortSignal.timeout(1000),
    })
    if (!inspect.ok || (await inspect.json()).id !== args[1]) throw new Error('Website 管理员账号不存在、已停用或身份服务不可用。')
  } else {
    composeOutput('full', ['exec', '-T', 'server', 'node', '--input-type=module', '-e',
      `const response = await fetch('http://127.0.0.1:8080/api/internal/identity/user/inspect', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bootstrap-Key': process.env.IDENTITY_BOOTSTRAP_KEY },
        body: JSON.stringify({ userId: process.argv[1] }), signal: AbortSignal.timeout(1000) });
      if (!response.ok || (await response.json()).id !== process.argv[1]) process.exit(1);`, args[1]])
  }
  await ensureHydraClient({ adminUrl: 'http://127.0.0.1:14445', clientSecret: values.OUTLINE_OIDC_CLIENT_SECRET })
  await ensureHydraClient({ adminUrl: 'http://127.0.0.1:14445', clientSecret: values.OIDC_PROBE_CLIENT_SECRET,
    clientId: 'ex-oidc-probe' })
  if (prior.mode === 'full') {
    compose('full', ['run', '--rm', '--no-deps', '-e', 'IDENTITY_BOOTSTRAP_KEY', 'outline',
      'yarn', 'integration:bootstrap', ...args], { IDENTITY_BOOTSTRAP_KEY: values.IDENTITY_BOOTSTRAP_KEY })
    return
  }
  const node = process.env.INTEGRATION_NODE_BIN || join(localRoot, 'tools', 'node26', 'node-v26.3.0-win-x64', 'node.exe')
  const corepack = process.env.INTEGRATION_COREPACK_JS || join(dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js')
  const outline = devProcesses(values, { node }).find(item => item.name === 'outline')
  const result = spawnSync(node, [corepack, 'yarn', 'integration:bootstrap', ...args], {
    cwd: outline.cwd, env: { ...outline.environment, IDENTITY_BOOTSTRAP_KEY: values.IDENTITY_BOOTSTRAP_KEY },
    stdio: 'inherit', shell: false,
  })
  if (result.status !== 0) throw new Error('Outline 工作区初始化失败。')
}

async function main() {
try {
  if (command === 'configure') {
    configure()
    console.log('本地配置已建立；未修改数据库。')
  } else if (command === 'init') {
    configured()
    await assertHosts()
    compose('dev', ['up', '-d', 'postgres', 'redis'])
    compose('dev', ['run', '--rm', 'hydra', 'migrate', 'sql', 'up', '--read-from-env', '--yes'])
    compose('full', ['run', '--rm', '--no-deps', '--build', 'server', 'node', 'dist/db/migrate.js'])
    compose('full', ['run', '--rm', '--no-deps', '--build', 'outline', 'yarn', 'db:migrate', '--env', 'production-ssl-disabled'])
    writeFileSync(initializedPath, JSON.stringify({ createdAt: new Date().toISOString() }))
  } else if (command === 'migrate') {
    configured()
    await assertHosts()
    compose('dev', ['up', '-d', 'postgres', 'redis'])
    compose('dev', ['run', '--rm', 'hydra', 'migrate', 'sql', 'up', '--read-from-env', '--yes'])
    compose('full', ['run', '--rm', '--no-deps', '--build', 'server', 'node', 'dist/db/migrate.js'])
    compose('full', ['run', '--rm', '--no-deps', '--build', 'outline', 'yarn', 'db:migrate', '--env', 'production-ssl-disabled'])
  } else if (command === 'up') {
    configured()
    requireInitialized()
    await assertHosts()
    assertMode('full')
    compose('full', ['up', '-d', '--build'])
    saveMode('full')
  } else if (command === 'dev') {
    await runDev()
  } else if (command === 'bootstrap') {
    await runBootstrap()
  } else if (command === 'down') {
    configured()
    const prior = existsSync(modePath) ? JSON.parse(readFileSync(modePath, 'utf8')) : { mode: 'full' }
    await requestHostStop(prior)
    const mode = prior.mode
    compose(mode, ['down'])
    writeFileSync(modePath, JSON.stringify({ mode, stoppedAt: new Date().toISOString() }))
  } else {
    throw new Error('用法：integration:configure|init|migrate|up|dev|bootstrap|down')
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
