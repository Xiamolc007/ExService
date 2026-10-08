import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseEnv } from 'node:util'
import { lookup } from 'node:dns/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { request as httpsRequest } from 'node:https'
import { configure, root, localRoot } from './configure.mjs'
import { atomicJson, digest, LocalError, otherOutboxTargets, readJson, toolchain } from './local-config.mjs'
import { Foundation, docker } from './foundation.mjs'
import { acquireLock, identityAlive, runOwned, spawnOwned, stopOwned } from './ownership.mjs'
import { assertPortFree, controlRequest, httpReady, supervise, validUuid } from './local-dev.mjs'
import { ensureHydraClient, verifyHydraClient } from './hydra-client.mjs'

const modePath = join(localRoot, 'mode.json'), initializedPath = join(localRoot, 'initialized.json')
const gatewayTemplate = join(localRoot, 'runtime-gateway.template')
const applications = ['server', 'web', 'outline', 'gateway']
const neverStarted = container => !container.State.Running && /^0001-01-01T00:00:00(?:\.0+)?Z$/.test(container.State.StartedAt ?? '')
const secretFingerprint = values => digest(Object.fromEntries(Object.entries(values).filter(([key]) => /PASSWORD|SECRET|KEY/.test(key))))
export function hostPort(value) {
  const match = /^host\.docker\.internal:([1-9]\d{0,4})$/.exec(value ?? '')
  if (!match || Number(match[1]) > 65535) throw new Error('开发 upstream 必须包含有效的宿主机端口。')
  return match[1]
}
export function devProcesses(values, options = {}) {
  const workspace = options.root ?? root, local = options.localRoot ?? localRoot, node = options.node ?? process.execPath
  const inherited = options.environment ?? process.env
  const serverPort = hostPort(values.WEBSITE_SERVER_UPSTREAM), webPort = hostPort(values.WEBSITE_WEB_UPSTREAM)
  const outlinePort = hostPort(values.OUTLINE_BACKEND_UPSTREAM), outlineVitePort = hostPort(values.OUTLINE_STATIC_UPSTREAM)
  const directPort = values.OUTLINE_DIRECT_UPSTREAM ? hostPort(values.OUTLINE_DIRECT_UPSTREAM) : outlinePort
  const common = { ...inherited, PATH: `${dirname(node)}${process.platform === 'win32' ? ';' : ':'}${inherited.PATH ?? ''}`,
    WEBSITE_INTEGRATION_ENABLED: 'true', WEBSITE_INTEGRATION_MODE: 'dev',
    HYDRA_PUBLIC_URL: 'http://identity.exwebsite.test:8090/', OUTLINE_OIDC_CLIENT_ID: 'ex-outline' }
  const targets = otherOutboxTargets('dev', workspace, inherited)
  if (targets) common.IDENTITY_OUTBOX_TARGETS_JSON = targets
  return [
    { name: 'server', cwd: workspace, args: ['pnpm', '--filter', '@workspace/server', 'dev'], environment: {
      ...common, DATABASE_URL: `postgres://exre:${values.EXRE_PASSWORD}@127.0.0.1:16432/exre`,
      AUTH_CODE_HMAC_KEY: values.AUTH_CODE_HMAC_KEY, SERVER_PUBLIC_WEB_BASE_URL: 'http://exwebsite.test:8090',
      SERVER_PUBLIC_AVATAR_BASE_URL: 'http://exwebsite.test:8090/api/avatars', SERVER_AVATAR_DIRECTORY: join(local, 'data/avatars'),
      SERVER_HOST: '0.0.0.0', SERVER_PORT: serverPort, OUTLINE_INTEGRATION_KEY: values.OUTLINE_INTEGRATION_KEY,
      IDENTITY_BOOTSTRAP_KEY: values.IDENTITY_BOOTSTRAP_KEY, IDENTITY_DELIVERY_KEY: values.IDENTITY_DELIVERY_KEY,
      IDENTITY_FLOW_KEY: values.IDENTITY_FLOW_KEY, HYDRA_ADMIN_URL: 'http://127.0.0.1:14445/',
      OUTLINE_INTERNAL_URL: `http://127.0.0.1:${outlinePort}/`, WEBSITE_INTERNAL_URL: `http://127.0.0.1:${serverPort}/`,
    } },
    { name: 'web', cwd: workspace, args: ['pnpm', '--filter', '@workspace/web', 'dev'], environment: {
      ...common, INTEGRATION_SERVER_PORT: serverPort, INTEGRATION_WEB_PORT: webPort,
    } },
    { name: 'outline', cwd: join(workspace, 'apps/outline'), args: ['yarn', 'dev:watch:integration'], environment: {
      ...common, NODE_ENV: 'development', URL: 'http://exwebsite.test:8090/docs', WEBSITE_URL: 'http://exwebsite.test:8090/', PORT: directPort,
      ...(values.OUTLINE_HTTP_PORT ? { OUTLINE_DEV_HTTP_PORT: values.OUTLINE_HTTP_PORT } : {}),
      INTEGRATION_OUTLINE_VITE_PORT: outlineVitePort, SECRET_KEY: values.OUTLINE_SECRET_KEY, UTILS_SECRET: values.OUTLINE_UTILS_SECRET,
      DATABASE_URL: `postgres://outline:${values.OUTLINE_PASSWORD}@127.0.0.1:16432/outline`, DATABASE_CONNECTION_POOL_URL: '',
      PGSSLMODE: 'disable', REDIS_URL: 'redis://127.0.0.1:16379', REDIS_COLLABORATION_URL: 'redis://127.0.0.1:16379',
      FILE_STORAGE: 'local', FILE_STORAGE_LOCAL_ROOT_DIR: join(local, 'data/outline'), FORCE_HTTPS: 'false',
      OUTLINE_INTEGRATION_KEY: values.OUTLINE_INTEGRATION_KEY, IDENTITY_DELIVERY_KEY: values.IDENTITY_DELIVERY_KEY,
      OUTLINE_OIDC_CLIENT_SECRET: values.OUTLINE_OIDC_CLIENT_SECRET, WEBSITE_INTERNAL_URL: `http://127.0.0.1:${serverPort}/`,
    } },
  ]
}
export function assertModeAvailable(prior, next, runningServices, hostAlive) {
  if (hostAlive || (prior.mode !== next && runningServices)) throw new Error(`当前 ${prior.mode} 模式仍在运行；先执行 node scripts/docs-integration/command.mjs down。`)
}
function valuesFor(mode) {
  const path = join(localRoot, `${mode}.env`)
  if (!existsSync(path)) throw new LocalError('LEGACY_NOT_CONFIGURED', 'node scripts/docs-integration/command.mjs configure')
  let values
  try { values = parseEnv(readFileSync(path, 'utf8')) } catch { throw new LocalError('LEGACY_CONFIG_INVALID') }
  for (const name of ['POSTGRES_PASSWORD', 'EXRE_PASSWORD', 'OUTLINE_PASSWORD', 'HYDRA_PASSWORD', 'AUTH_CODE_HMAC_KEY',
    'OUTLINE_SECRET_KEY', 'OUTLINE_UTILS_SECRET', 'HYDRA_SYSTEM_SECRET', 'OUTLINE_INTEGRATION_KEY', 'IDENTITY_BOOTSTRAP_KEY',
    'IDENTITY_DELIVERY_KEY', 'IDENTITY_FLOW_KEY', 'OUTLINE_OIDC_CLIENT_SECRET', 'OIDC_PROBE_CLIENT_SECRET']) {
    if (!/^[0-9a-f]{64}$/.test(values[name] ?? '')) throw new LocalError('LEGACY_SECRETS_INVALID')
  }
  if (mode === 'dev') {
    const ports = ['WEBSITE_SERVER_UPSTREAM', 'WEBSITE_WEB_UPSTREAM', 'OUTLINE_BACKEND_UPSTREAM', 'OUTLINE_DIRECT_UPSTREAM', 'OUTLINE_STATIC_UPSTREAM'].map(key => hostPort(values[key]))
    if (values.OUTLINE_HTTP_PORT !== ports[2] || new Set(ports).size !== ports.length || ports.some(port => ['8090', '16432', '16379', '14445'].includes(port)))
      throw new LocalError('LEGACY_HTTP_TRANSPORT_CONFIG_INVALID', 'node scripts/docs-integration/command.mjs configure; optionally set INTEGRATION_OUTLINE_HTTP_PORT explicitly')
  }
  return values
}
async function assertHosts() {
  for (const host of ['exwebsite.test', 'identity.exwebsite.test']) {
    let record
    try { record = await lookup(host, { family: 4 }) } catch { throw new LocalError('LEGACY_HOSTS_MISSING', 'map exwebsite.test and identity.exwebsite.test to 127.0.0.1') }
    if (record.address !== '127.0.0.1') throw new LocalError('LEGACY_HOSTS_INVALID')
  }
}
const staticTls = () => existsSync(join(root, 'apps/outline/server/config/certs/private.key')) && existsSync(join(root, 'apps/outline/server/config/certs/public.cert'))
export function awaitingGatewayTemplate(template) {
  for (const path of ['/docs/static/', '/docs/']) {
    const block = new RegExp(`^  location \\^~ ${path} \\{\\r?\\n[\\s\\S]*?^  }`, 'gm')
    if ([...template.matchAll(block)].length !== 1) throw new LocalError('LEGACY_GATEWAY_TEMPLATE_CHANGED')
    template = template.replace(block, `  location ^~ ${path} { return 503; }`)
  }
  return template
}
function writeGateway(ready, mode = 'full') {
  let template = readFileSync(join(root, 'infra/docs-integration/gateway/default.conf.template'), 'utf8')
  if (mode === 'dev' && staticTls()) template = template.replace('proxy_pass http://${OUTLINE_STATIC_UPSTREAM};', 'proxy_pass https://${OUTLINE_STATIC_UPSTREAM};')
  if (!ready) template = awaitingGatewayTemplate(template)
  writeFileSync(gatewayTemplate, template)
  return digest(template)
}
export function websiteRuntimeRecipe(source) {
  if (!source.includes('RUN pnpm install --frozen-lockfile') || /vendor\/exui|COPY --from=exui/.test(source))
    throw new LocalError('FULL_DOCKERFILE_ANCHOR_CHANGED', 'review the Website Dockerfile before regenerating the local runtime recipe')
  return source
}
function runtimeRecipe(generate) {
  const path = join(localRoot, 'Dockerfile.website-runtime')
  const desired = websiteRuntimeRecipe(readFileSync(join(root, 'Dockerfile'), 'utf8'))
  if (existsSync(path) && readFileSync(path, 'utf8') !== desired) throw new LocalError('FULL_RUNTIME_RECIPE_CONFLICT', 'review the existing generated recipe before explicit regeneration')
  if (!existsSync(path)) {
    if (!generate) throw new LocalError('FULL_RUNTIME_RECIPE_MISSING')
    writeFileSync(path, desired)
  }
  return { path, fingerprint: digest(desired) }
}
export function legacyInitRecipe(source) {
  const normalized = source.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('#!/bin/sh\nset -eu\n') || normalized.includes('\r')) throw new LocalError('LEGACY_INIT_SOURCE_INVALID')
  return normalized
}
function runtimeInit(generate) {
  const path = join(localRoot, 'runtime-init.sh'), desired = legacyInitRecipe(readFileSync(join(root, 'infra/docs-integration/postgres/init.sh'), 'utf8'))
  if (existsSync(path) && readFileSync(path, 'utf8') !== desired) throw new LocalError('LEGACY_INIT_RECIPE_CONFLICT', 'review the original initializer before explicitly regenerating its LF runtime copy')
  if (!existsSync(path)) {
    if (!generate) throw new LocalError('LEGACY_INIT_RECIPE_MISSING')
    writeFileSync(path, desired)
  }
  return { path, fingerprint: digest(desired) }
}
export function legacyRuntimeServices(mode, { gatewayPath = gatewayTemplate, recipePath, targets,
  postgresPort = 16432, redisPort = 16379, initPath = join(localRoot, 'runtime-init.sh'), workspace = root } = {}) {
  const images = readJson(join(workspace, 'infra/docs-integration/images.lock.json'))
  const services = {
    postgres: { ports: [`127.0.0.1:${postgresPort}:5432`], healthcheck: { test: ['CMD-SHELL', 'pg_isready -h 127.0.0.1 -U postgres'] },
      volumes: [{ type: 'bind', source: initPath, target: '/docker-entrypoint-initdb.d/10-integrated-databases.sh', read_only: true }] },
    redis: { ports: [`127.0.0.1:${redisPort}:6379`] },
    gateway: { volumes: [{ type: 'bind', source: gatewayPath, target: '/etc/nginx/templates/default.conf.template', read_only: true }] },
    verifier: { image: images.node, profiles: ['preparation'], entrypoint: ['node'], command: ['/tmp/prepare-hydra.mjs'],
      environment: { OUTLINE_OIDC_CLIENT_SECRET: '${OUTLINE_OIDC_CLIENT_SECRET:?configure first}', OIDC_PROBE_CLIENT_SECRET: '${OIDC_PROBE_CLIENT_SECRET:?configure first}' },
      volumes: ['prepare-hydra.mjs', 'hydra-client.mjs'].map(name => ({ type: 'bind', source: join(workspace, 'scripts/docs-integration', name), target: `/tmp/${name}`, read_only: true })),
      read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], restart: 'no' },
  }
  if (mode === 'full') {
    services.server = { build: { dockerfile: recipePath }, extra_hosts: { 'host.docker.internal': 'host-gateway' },
      environment: { WEBSITE_INTEGRATION_MODE: 'full', HYDRA_PUBLIC_URL: 'http://identity.exwebsite.test:8090/',
        WEBSITE_INTERNAL_URL: 'http://server:8080/', ...(targets ? { IDENTITY_OUTBOX_TARGETS_JSON: targets } : {}) } }
    services.outline = { environment: { WEBSITE_INTEGRATION_MODE: 'full', WEBSITE_URL: 'http://exwebsite.test:8090/' } }
    services.web = { build: { dockerfile: recipePath } }
  }
  return services
}
function runtime(mode, values, { generate = true, ready = true } = {}) {
  const overridePath = join(localRoot, `runtime-${mode}.json`)
  const targets = otherOutboxTargets(mode)
  const initializer = runtimeInit(generate)
  const recipe = mode === 'full' ? runtimeRecipe(generate) : undefined
  if (generate) {
    const services = legacyRuntimeServices(mode, { recipePath: recipe?.path, targets, initPath: initializer.path })
    atomicJson(overridePath, { services })
    writeGateway(ready, mode)
  }
  const fingerprint = digest({ mode, values, override: readJson(overridePath), recipe: recipe?.fingerprint, initializer: initializer.fingerprint,
    gatewayBase: readFileSync(join(root, 'infra/docs-integration/gateway/default.conf.template'), 'utf8') })
  const foundation = new Foundation({ workspace: root, fingerprint }, { project: 'exwebsite-docs-integration', file: 'compose.yaml',
    overlays: [`compose.${mode}.yaml`, overridePath], envFile: join(localRoot, `${mode}.env`), environment: { ...process.env, ...values }, fingerprint })
  return { fingerprint, foundation, directory: localRoot, values, mode }
}
function externalCheck(prior) {
  const running = docker(['ps', '--filter', 'label=com.docker.compose.project=exwebsite-docs-integration', '--format', '{{.Label "com.docker.compose.service"}}']).stdout.trim().split(/\r?\n/)
  if (running.some(service => applications.includes(service))) throw new LocalError('LEGACY_APPLICATION_OWNER_UNKNOWN', 'stop applications using their verified original run; no containers were stopped')
  if (existsSync(modePath)) {
    const legacy = readJson(modePath)
    if (!legacy.stoppedAt && !legacy.identity) throw new LocalError('LEGACY_MODE_OWNER_UNKNOWN', 'stop the original legacy terminal; no stale PIDs were killed')
    if (!legacy.stoppedAt && legacy.identity && identityAlive(legacy.identity)) throw new LocalError('LEGACY_MODE_ACTIVE')
  }
}
function initialized(state) {
  const record = readJson(initializedPath, 'LEGACY_NOT_INITIALIZED')
  // Init is shared by both old modes, while runtime port/mode fingerprints stay separate.
  if (record.secretFingerprint !== secretFingerprint(state.values)) throw new LocalError('LEGACY_PREPARED_TARGET_CHANGED', 'node scripts/docs-integration/command.mjs init')
  transitionStoppedApplications(state, readJsonOptional(modePath), record.volumes)
  state.foundation.preflight(true, record.volumes)
  return record
}
export function transitionStoppedApplications(state, prior, preparedVolumes) {
  if (digest(state.foundation.verifyVolumes()) !== digest(preparedVolumes)) throw new LocalError('LOCAL_VOLUME_IDENTITY_CHANGED')
  const proofs = new Map((prior?.resources?.containerProofs ?? []).map(proof => [proof.id, proof]))
  const createdStopped = new Set((prior?.resources?.createdStopped ?? []).map(item => item.id))
  const owned = new Set([...(prior?.resources?.started ?? []), ...(prior?.resources?.createdStopped ?? [])].map(item => item.id)), retire = []
  for (const container of state.foundation.containers()) {
    if (container.Config.Labels['com.docker.compose.oneoff']?.toLowerCase() === 'true') continue
    const service = container.Config.Labels['com.docker.compose.service']
    if (applications.includes(service)) {
      if (!owned.has(container.Id)) throw new LocalError('STOPPED_APPLICATION_OWNER_UNKNOWN')
      if (prior?.stoppedAt && container.State.Running) throw new LocalError('STOPPED_APPLICATION_RESTARTED')
      state.foundation.verifyRecordedContainer(container, proofs.get(container.Id))
      if (createdStopped.has(container.Id)) {
        if (!prior?.stoppedAt || !neverStarted(container)) throw new LocalError('STOPPED_CREATED_APPLICATION_STARTED')
        state.foundation.verifyContainer(container, service)
        retire.push(container.Id)
        continue
      }
    }
    try { state.foundation.verifyContainer(container, service); continue } catch (error) {
      if (!prior?.stoppedAt || container.State.Running || !applications.includes(service) || !owned.has(container.Id)) throw error
      state.foundation.verifyRecordedContainer(container, proofs.get(container.Id))
      retire.push(container.Id)
    }
  }
  // Validate the complete set before mutation. Non-force rm also refuses a
  // concurrently restarted container. No volume or bind data is removed.
  for (const id of retire) {
    const container = state.foundation.inspect(id)
    if (!container) continue
    if (container.State.Running) throw new LocalError('STOPPED_APPLICATION_RESTARTED')
    state.foundation.verifyRecordedContainer(container, proofs.get(id))
    if (createdStopped.has(id) && !neverStarted(container)) throw new LocalError('STOPPED_CREATED_APPLICATION_STARTED')
    state.foundation.call(['rm', id])
  }
  return retire
}
function activeMode({ allowStopped = false } = {}) {
  if (!existsSync(modePath)) throw new LocalError('LEGACY_START_REQUIRED', 'pnpm integration:dev or pnpm integration:up')
  const record = readJson(modePath)
  if (record.stoppedAt && !allowStopped || !['dev', 'full'].includes(record.mode)) throw new LocalError('LEGACY_START_REQUIRED')
  return record.mode
}
async function readinessDev(state, children, limited) {
  const server = hostPort(state.values.WEBSITE_SERVER_UPSTREAM), web = hostPort(state.values.WEBSITE_WEB_UPSTREAM)
  await httpReady(`http://127.0.0.1:${server}/api/health`, { children })
  await httpReady(`http://127.0.0.1:${web}/`, { children, headers: { Host: 'exwebsite.test' } })
  await httpReady('http://127.0.0.1:8090/api/health', { children, headers: { Host: 'exwebsite.test' } })
  if (!limited) {
    await httpReady(`http://127.0.0.1:${hostPort(state.values.OUTLINE_BACKEND_UPSTREAM)}/_health`, { children })
    await httpReady('http://127.0.0.1:8090/docs/', { children, headers: { Host: 'exwebsite.test' } })
    if (staticTls()) await staticReadyTls(Number(hostPort(state.values.OUTLINE_STATIC_UPSTREAM)), children)
    else await httpReady(`http://127.0.0.1:${hostPort(state.values.OUTLINE_STATIC_UPSTREAM)}/docs/static/@vite/client`, { children })
  }
}
async function staticReadyTls(port, children) {
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    if (children.some(child => child.child.exitCode !== null || child.child.signalCode !== null)) throw new LocalError('LEGACY_APP_EXITED')
    const ready = await new Promise(resolve => {
      // The original development Vite target alone uses its existing self-signed certificate.
      const request = httpsRequest({ host: '127.0.0.1', port, path: '/docs/static/@vite/client', rejectUnauthorized: false }, response => {
        response.resume(); resolve(response.statusCode === 200)
      })
      request.once('error', () => resolve(false)); request.setTimeout(1000, () => request.destroy()); request.end()
    })
    if (ready) return
    await delay(250)
  }
  throw new LocalError('LEGACY_STATIC_NOT_READY')
}
const hydraOptions = values => ({ adminUrl: 'http://127.0.0.1:14445/', publicUrl: 'http://identity.exwebsite.test:8090/', clientSecret: values.OUTLINE_OIDC_CLIENT_SECRET })
async function checkPreparedDev(state, tools) {
  const record = readJson(initializedPath)
  const specs = devProcesses(state.values, { node: tools.node })
  const log = (name, line) => console.log(`[${name}] ${line}`)
  const server = specs.find(spec => spec.name === 'server'), outline = specs.find(spec => spec.name === 'outline')
  await runOwned({ ...server, command: tools.node, args: [tools.corepack, 'pnpm', '--filter', '@workspace/server', 'integration:check'] }, { onLog: log, code: 'LEGACY_WEBSITE_NOT_READY' })
  if (!record.adminUserId) return false
  await runOwned({ ...outline, command: tools.node, args: [tools.corepack, 'yarn', 'integration:check', '--admin-user-id', record.adminUserId] }, { onLog: log, code: 'LEGACY_OUTLINE_NOT_READY' })
  await verifyHydraClient(hydraOptions(state.values))
  await verifyHydraClient({ ...hydraOptions(state.values), clientId: 'ex-oidc-probe', clientSecret: state.values.OIDC_PROBE_CLIENT_SECRET })
  return true
}
async function bootstrapDev(state, tools, lock, adminUserId) {
  const specs = devProcesses(state.values, { node: tools.node }), log = (name, line) => console.log(`[${name}] ${line}`)
  const server = specs.find(spec => spec.name === 'server'), outline = specs.find(spec => spec.name === 'outline')
  await assertPortFree(Number(server.environment.SERVER_PORT))
  await runOwned({ ...server, command: tools.node, args: [tools.corepack, 'pnpm', '--filter', '@workspace/server', 'integration:check', '--admin-user-id', adminUserId] }, { onLog: log, code: 'LEGACY_ADMIN_NOT_READY' })
  let temporary
  try {
    temporary = await spawnOwned({ ...server, name: 'temporary-server', command: tools.node, cwd: join(root, 'apps/server'),
      args: ['--env-file-if-exists=.env.local', '--import', 'tsx', 'src/server.ts'] }, { onLog: log })
    lock.update({ temporary: temporary.identity })
    await httpReady(`http://127.0.0.1:${server.environment.SERVER_PORT}/api/health`, { children: [temporary] })
    const response = await fetch(`http://127.0.0.1:${server.environment.SERVER_PORT}/api/internal/identity/user/inspect`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bootstrap-Key': state.values.IDENTITY_BOOTSTRAP_KEY }, body: JSON.stringify({ userId: adminUserId }), signal: AbortSignal.timeout(2000),
    })
    if (!response.ok || (await response.json()).id !== adminUserId) throw new LocalError('LEGACY_ADMIN_NOT_ACTIVE')
    // Gateway is paused too; expose the existing Hydra public service inside a disposable verifier container.
    await prepareHydraWithoutGateway(state, lock.record.runId)
    await runOwned({ ...outline, environment: { ...outline.environment, IDENTITY_BOOTSTRAP_KEY: state.values.IDENTITY_BOOTSTRAP_KEY }, command: tools.node,
      args: [tools.corepack, 'yarn', 'integration:bootstrap', '--admin-user-id', adminUserId] }, { onLog: log, code: 'LEGACY_BOOTSTRAP_FAILED' })
    await runOwned({ ...outline, command: tools.node, args: [tools.corepack, 'yarn', 'integration:check', '--admin-user-id', adminUserId] }, { onLog: log, code: 'LEGACY_OUTLINE_NOT_READY' })
    atomicJson(initializedPath, { ...readJson(initializedPath), adminUserId })
    writeGateway(true, 'dev')
  } finally { if (temporary) await stopOwned([temporary]); lock.update({ temporary: null }) }
}
export async function prepareHydraWithoutGateway(state, runId) {
  // A verifier runs on the existing Compose network and calls Hydra's public port directly,
  // while metadata keeps the real legacy issuer. No public gateway or app is brought up.
  if (!validUuid(runId)) throw new LocalError('VERIFIER_RUN_ID_INVALID')
  const expected = state.foundation.configuration({ preparation: true }).services.verifier
  if (!expected || expected.image !== readJson(join(root, 'infra/docs-integration/images.lock.json')).node) throw new LocalError('VERIFIER_CONFIGURATION_INVALID')
  const hydra = state.foundation.containers().find(container => container.Config.Labels['com.docker.compose.service'] === 'hydra' && container.State.Running)
  if (!hydra) throw new LocalError('LEGACY_HYDRA_NOT_RUNNING')
  state.foundation.verifyContainer(hydra, 'hydra')
  const { randomUUID } = await import('node:crypto'), name = `exwebsite-verifier-${randomUUID()}`
  if (state.foundation.inspect(name)) throw new LocalError('VERIFIER_NAME_OCCUPIED')
  try {
    const result = state.foundation.compose(['run', '--rm', '--no-deps', '--name', name, '--label', `dev.exwebsite.run=${runId}`, 'verifier'], true)
    console.log(`VERIFIER_CHILD_EXIT code=${result.status ?? 'signal'}`)
    if (result.status !== 0) throw new LocalError('LEGACY_HYDRA_PREPARE_FAILED', 'retry the explicit bootstrap after checking this run\'s Hydra clients')
    return { status: result.status }
  } finally {
    const actual = state.foundation.inspect(name)
    if (actual) {
      const labels = actual.Config.Labels ?? {}
      if (labels['dev.exwebsite.run'] !== runId || labels['com.docker.compose.project'] !== state.foundation.project ||
          labels['com.docker.compose.service'] !== 'verifier' || labels['com.docker.compose.oneoff']?.toLowerCase() !== 'true' || actual.Config.Image !== expected.image)
        throw new LocalError('VERIFIER_CLEANUP_IDENTITY_INVALID')
      state.foundation.call(['rm', '-f', actual.Id])
    }
  }
}
export async function pauseContainers(state, registry) {
  const managed = new Set(registry.map(item => item.id))
  if (state.foundation.containers().some(container => container.State.Running && applications.includes(container.Config.Labels['com.docker.compose.service']) && !managed.has(container.Id)))
    throw new LocalError('FULL_APPLICATION_OWNER_UNKNOWN')
  const verified = [], originals = new Map()
  for (const item of registry) {
    const recorded = state.foundation.proofs.get(item.id)
    if (!recorded || recorded.service !== item.service) throw new LocalError('FOUNDATION_JOURNAL_INVALID')
    originals.set(item.id, recorded)
    const actual = state.foundation.inspect(item.id)
    if (!actual) continue
    if (actual.Config.Labels['com.docker.compose.service'] !== item.service) throw new LocalError('FULL_APPLICATION_IDENTITY_CHANGED')
    state.foundation.verifyRecordedContainer(actual, recorded)
    state.foundation.verifyContainer(actual, item.service)
    if (actual.State.Running) verified.push(item)
  }
  const verifyPaused = item => {
    const actual = state.foundation.inspect(item.id)
    if (!actual) return // inspect proves absence against the complete inventory.
    state.foundation.verifyRecordedContainer(actual, originals.get(item.id))
    state.foundation.verifyContainer(actual, item.service)
    if (actual.State?.Running !== false) throw new LocalError('FULL_APPLICATION_STOP_INCOMPLETE')
  }
  for (const item of verified.reverse()) {
    state.foundation.call(['stop', '--time', '10', item.id])
    verifyPaused(item)
  }
  for (const item of registry) verifyPaused(item)
}
async function fullReady(state, limited) {
  for (const service of ['server', 'web', ...(limited ? [] : ['outline']), 'gateway']) {
    const container = state.foundation.containers().find(item => item.Config.Labels['com.docker.compose.service'] === service && item.Config.Labels['com.docker.compose.oneoff']?.toLowerCase() === 'false')
    if (!container?.State.Running) throw new LocalError('FULL_APPLICATION_NOT_RUNNING')
    state.foundation.verifyContainer(container, service)
  }
  await httpReady('http://127.0.0.1:8090/api/health', { headers: { Host: 'exwebsite.test' }, timeout: 120000 })
  await httpReady('http://127.0.0.1:8090/', { headers: { Host: 'exwebsite.test' }, timeout: 120000 })
  if (!limited) await httpReady('http://127.0.0.1:8090/docs/', { headers: { Host: 'exwebsite.test' }, timeout: 120000 })
}
function verifyTemporary(state, record, actual) {
  const labels = actual.Config.Labels ?? {}
  if (!record.temporaryContainer || !record.temporaryProof) throw new LocalError('TEMPORARY_CONTAINER_PROOF_MISSING')
  if (!record.temporaryExpectedImage || actual.Image !== record.temporaryExpectedImage || actual.Id !== record.temporaryContainer || labels['dev.exwebsite.run'] !== record.runId ||
      labels['com.docker.compose.project'] !== state.foundation.project || labels['com.docker.compose.service'] !== 'server' ||
      labels['com.docker.compose.oneoff']?.toLowerCase() !== 'true' || digest(state.foundation.containerProof(actual)) !== digest(record.temporaryProof))
    throw new LocalError('TEMPORARY_CONTAINER_IDENTITY_INVALID')
}
function verifyTemporaryGroup(state, record) {
  const foundation = state.foundation, resources = record.resources
  if (!record.temporaryName || !record.temporaryExpectedImage || !resources || !Array.isArray(resources.started) ||
      !Array.isArray(resources.preRunning) || !Array.isArray(resources.containerProofs) ||
      resources.createdStopped && !Array.isArray(resources.createdStopped)) throw new LocalError('FOUNDATION_JOURNAL_INVALID')
  if (digest(foundation.verifyVolumes()) !== digest(record.preparedVolumes)) throw new LocalError('LOCAL_VOLUME_IDENTITY_CHANGED')
  const created = new Set((resources.createdStopped ?? []).map(item => item.id))
  const known = new Map([...resources.started, ...resources.preRunning, ...(resources.createdStopped ?? [])].map(item => [item.id, item]))
  const proofs = new Map(resources.containerProofs.map(item => [item.id, item]))
  const sources = resources.started.filter(item => item.service === 'server')
  if (sources.length !== 1 || sources[0].id !== record.temporarySourceId) throw new LocalError('TEMPORARY_IMAGE_SOURCE_INVALID')
  for (const item of known.values()) {
    if (!item.id || !item.service || proofs.get(item.id)?.service !== item.service) throw new LocalError('FOUNDATION_JOURNAL_INVALID')
    const actual = foundation.inspect(item.id)
    if (!actual) continue
    foundation.verifyRecordedContainer(actual, proofs.get(item.id)); foundation.verifyContainer(actual, item.service)
    if (item.id === record.temporarySourceId && actual.Image !== record.temporaryExpectedImage) throw new LocalError('TEMPORARY_IMAGE_SOURCE_INVALID')
    if (created.has(item.id) && !neverStarted(actual)) throw new LocalError('FOUNDATION_CREATED_STATE_CHANGED')
  }
  const identified = record.temporaryContainer ? foundation.inspect(record.temporaryContainer) : null
  const named = foundation.inspect(record.temporaryName)
  if (named && record.temporaryContainer && named.Id !== record.temporaryContainer) throw new LocalError('TEMPORARY_CONTAINER_IDENTITY_INVALID')
  const temporary = identified ?? named
  if (temporary) verifyTemporary(state, record, temporary)
  for (const actual of foundation.containers()) {
    if (actual.Id === record.temporaryContainer) verifyTemporary(state, record, actual)
    else {
      if (!known.has(actual.Id)) throw new LocalError('FOUNDATION_OWNER_UNKNOWN')
      foundation.verifyRecordedContainer(actual, proofs.get(actual.Id))
    }
  }
  return temporary
}
function cleanupTemporary(state, record) {
  const actual = verifyTemporaryGroup(state, record)
  if (!actual) return
  if (actual.State?.Running !== false) state.foundation.call(['stop', '--time', '10', actual.Id])
  const stopped = state.foundation.inspect(actual.Id)
  if (stopped) {
    verifyTemporary(state, record, stopped)
    if (stopped.State?.Running !== false) throw new LocalError('TEMPORARY_CONTAINER_STOP_INCOMPLETE')
    state.foundation.call(['rm', stopped.Id]) // only this proven oneoff; non-force, no volumes
    if (state.foundation.inspect(stopped.Id)) throw new LocalError('TEMPORARY_CONTAINER_CLEANUP_INCOMPLETE')
  }
}
export async function bootstrapFull(state, lock, adminUserId) {
  let temporary
  if (lock.record.temporaryContainer || lock.record.temporaryName) throw new LocalError('TEMPORARY_CONTAINER_CLEANUP_REQUIRED')
  const { randomUUID } = await import('node:crypto')
  const name = `exwebsite-bootstrap-${randomUUID()}`
  if (state.foundation.inspect(name)) throw new LocalError('TEMPORARY_CONTAINER_NAME_OCCUPIED')
  const sources = lock.record.resources?.started?.filter(item => item.service === 'server') ?? []
  if (sources.length !== 1) throw new LocalError('TEMPORARY_IMAGE_SOURCE_INVALID')
  const source = state.foundation.inspect(sources[0].id)
  if (!source?.Image || source.State?.Running !== false) throw new LocalError('TEMPORARY_IMAGE_SOURCE_INVALID')
  state.foundation.verifyRecordedContainer(source, lock.record.resources.containerProofs?.find(proof => proof.id === source.Id))
  state.foundation.verifyContainer(source, 'server')
  const expectedImage = source.Image
  let attempted = false
  try {
    state.foundation.compose(['run', '--rm', '--no-deps', 'server', 'node', 'dist/cli/integration-check.js', '--admin-user-id', adminUserId])
    lock.update({ cleanupRequired: true, temporaryName: name, temporaryExpectedImage: expectedImage, temporarySourceId: source.Id })
    attempted = true
    const result = state.foundation.compose(['run', '-d', '--rm', '--no-deps', '--use-aliases', '--name', name,
      '--label', `dev.exwebsite.run=${lock.record.runId}`, 'server'])
    lock.update({ temporaryContainer: result.stdout.trim() })
    temporary = state.foundation.inspect(lock.record.temporaryContainer)
    if (!temporary) throw new LocalError('TEMPORARY_CONTAINER_IDENTITY_INVALID')
    lock.update({ temporaryProof: state.foundation.containerProof(temporary) })
    verifyTemporary(state, lock.record, temporary)
    state.foundation.call(['cp', join(root, 'scripts/docs-integration/inspect-user.mjs'), `${temporary.Id}:/tmp/inspect-user.mjs`])
    let ready = false
    for (let count = 0; count < 120; count++) {
      if (state.foundation.call(['exec', temporary.Id, 'node', '/tmp/inspect-user.mjs', 'health'], true).status === 0) { ready = true; break }
      if (!state.foundation.inspect(temporary.Id)?.State.Running) break
      await delay(250)
    }
    if (!ready) throw new LocalError('TEMPORARY_WEBSITE_NOT_READY')
    state.foundation.call(['exec', temporary.Id, 'node', '/tmp/inspect-user.mjs', 'inspect', adminUserId])
    await prepareHydraWithoutGateway(state, lock.record.runId)
    state.foundation.compose(['run', '--rm', '--no-deps', '-e', 'IDENTITY_BOOTSTRAP_KEY', 'outline', 'yarn', 'integration:bootstrap', '--admin-user-id', adminUserId])
    state.foundation.compose(['run', '--rm', '--no-deps', 'outline', 'yarn', 'integration:check', '--admin-user-id', adminUserId])
    atomicJson(initializedPath, { ...readJson(initializedPath), adminUserId })
    writeGateway(true)
  } finally {
    if (attempted) cleanupTemporary(state, lock.record)
    lock.update({ temporaryContainer: null, temporaryProof: null, temporaryName: null, temporaryExpectedImage: null, temporarySourceId: null })
  }
}
export async function prepareFullRuntime(state, lock, adminUserId, {
  prepare = bootstrapFull, ready = fullReady,
  gatewayDigest = () => digest(readFileSync(gatewayTemplate, 'utf8')),
} = {}) {
  lock.update({ state: 'pausing', cleanupRequired: true })
  try { await pauseContainers(state, lock.record.managedApplications) }
  catch (error) { lock.update({ state: 'cleanup-failed', cleanupRequired: true }); throw error }
  lock.update({ state: 'preparing' })
  try {
    await prepare(state, lock, adminUserId)
    await state.foundation.start(applications, { onChange: resources => lock.update({ resources }) })
    await ready(state, false)
    lock.update({ state: 'ready', cleanupRequired: false, managedApplications: [...state.foundation.started.values()].filter(item => applications.includes(item.service)),
      gatewayDigest: gatewayDigest() })
  } catch (error) {
    try { await pauseContainers(state, [...state.foundation.started.values()].filter(item => applications.includes(item.service))) }
    catch (cleanupError) { lock.update({ state: 'cleanup-failed', cleanupRequired: true }); throw cleanupError }
    if (lock.record.temporaryContainer || lock.record.temporaryName) {
      lock.update({ state: 'cleanup-failed', cleanupRequired: true })
      throw error
    }
    lock.update({ state: 'preparation-failed', cleanupRequired: false, gatewayDigest: gatewayDigest() })
    throw error
  }
}
function fullSnapshot(state) {
  const snapshot = state.foundation.snapshot(), createdStopped = [...new Map([...(snapshot.createdStopped ?? []), ...(state.createdStopped?.values() ?? [])].map(item => [item.id, item])).values()]
  return { ...snapshot, createdStopped, containerProofs: [...new Map([...snapshot.containerProofs,
    ...createdStopped.map(item => state.foundation.proofs.get(item.id)).filter(Boolean)].map(item => [item.id, item])).values()] }
}
function fullOwnedResources(state, prior, preparedVolumes, { stopped = true } = {}) {
  if (digest(state.foundation.verifyVolumes()) !== digest(preparedVolumes)) throw new LocalError('LOCAL_VOLUME_IDENTITY_CHANGED')
  const snapshot = fullSnapshot(state), currentCreated = new Set(snapshot.createdStopped.map(item => item.id))
  const oldCreated = new Set((prior?.resources?.createdStopped ?? []).map(item => item.id))
  const current = new Map([...snapshot.started, ...snapshot.createdStopped].map(item => [item.id, item]))
  const proofs = new Map(snapshot.containerProofs.map(proof => [proof.id, proof]))
  const oldOwned = new Map([...(prior?.resources?.started ?? []), ...(prior?.resources?.createdStopped ?? [])].map(item => [item.id, item]))
  const oldProofs = new Map((prior?.resources?.containerProofs ?? []).map(proof => [proof.id, proof]))
  const retained = new Map()
  for (const container of state.foundation.containers()) {
    if (container.Config.Labels['com.docker.compose.oneoff']?.toLowerCase() === 'true') {
      if (container.State.Running) throw new LocalError('PREPARATION_CONTAINER_ACTIVE')
      continue
    }
    const service = container.Config.Labels['com.docker.compose.service']
    let owned = current.get(container.Id), proof = proofs.get(container.Id)
    if (!owned && applications.includes(service)) { owned = oldOwned.get(container.Id); proof = oldProofs.get(container.Id) }
    if (!owned) {
      if (applications.includes(service)) throw new LocalError('STOPPED_APPLICATION_OWNER_UNKNOWN')
      state.foundation.verifyContainer(container, service)
      continue
    }
    if (container.State.Running && (stopped || !current.has(container.Id))) throw new LocalError('STOPPED_RESOURCE_RESTARTED')
    if (owned.service !== service) throw new LocalError('FULL_APPLICATION_IDENTITY_CHANGED')
    if ((currentCreated.has(container.Id) || oldCreated.has(container.Id)) && !neverStarted(container)) throw new LocalError('STOPPED_CREATED_APPLICATION_STARTED')
    state.foundation.verifyRecordedContainer(container, proof)
    state.foundation.verifyContainer(container, service)
    retained.set(container.Id, owned); proofs.set(container.Id, state.foundation.containerProof(container))
  }
  const createdStopped = [...retained.values()].filter(item => currentCreated.has(item.id) || oldCreated.has(item.id))
  return { preRunning: snapshot.preRunning, started: [...retained.values()].filter(item => !currentCreated.has(item.id) && !oldCreated.has(item.id)), createdStopped,
    containerProofs: [...new Set([...retained.keys(), ...snapshot.preRunning.map(item => item.id)])].map(id => proofs.get(id)) }
}
export async function fullUpRuntime(state, lock, prepared, {
  modeRecordPath = modePath, prior = readJsonOptional(modeRecordPath),
  build = () => state.foundation.compose(['build', 'server', 'web', 'outline']),
  check = () => {
    state.foundation.compose(['run', '--rm', '--no-deps', 'server', 'node', 'dist/cli/integration-check.js'])
    if (prepared.adminUserId) state.foundation.compose(['run', '--rm', '--no-deps', 'outline', 'yarn', 'integration:check', '--admin-user-id', prepared.adminUserId])
  }, ready = fullReady,
  verifyClients = async () => {
    if (prepared.adminUserId) {
      await verifyHydraClient(hydraOptions(state.values))
      await verifyHydraClient({ ...hydraOptions(state.values), clientId: 'ex-oidc-probe', clientSecret: state.values.OIDC_PROBE_CLIENT_SECRET })
    }
  }, gatewayDigest = () => digest(readFileSync(gatewayTemplate, 'utf8')),
} = {}) {
  const save = extra => { atomicJson(modeRecordPath, { ...lock.record, ...extra }); lock.update(extra) }
  try {
    lock.update({ preparedVolumes: prepared.volumes, gatewayDigest: gatewayDigest() })
    await state.foundation.start(['postgres', 'redis', 'hydra'], { onChange: () => lock.update({ resources: fullSnapshot(state) }) })
    await build(); await check()
    for (const service of ['server', 'web', ...(prepared.adminUserId ? ['outline'] : []), 'gateway']) {
      const existing = state.foundation.containers(), before = new Set(existing.map(container => container.Id))
      for (const container of existing.filter(item => item.Config.Labels['com.docker.compose.service'] === service && item.Config.Labels['com.docker.compose.oneoff']?.toLowerCase() === 'false')) {
        const owned = [...(prior?.resources?.started ?? []), ...(prior?.resources?.createdStopped ?? [])].find(item => item.id === container.Id)
        if (!owned) throw new LocalError('STOPPED_APPLICATION_OWNER_UNKNOWN')
        if (container.State.Running) throw new LocalError('STOPPED_APPLICATION_RESTARTED')
        state.foundation.verifyRecordedContainer(container, prior.resources.containerProofs?.find(proof => proof.id === container.Id))
      }
      try { await state.foundation.start([service], { onChange: () => lock.update({ resources: fullSnapshot(state) }) }) }
      finally {
        // A failed Compose start may have created this service without running
        // it. Preserve that exact newly created, verified ID as owned too.
        const created = state.foundation.containers().filter(container => !before.has(container.Id) &&
          container.Config.Labels['com.docker.compose.service'] === service && container.Config.Labels['com.docker.compose.oneoff']?.toLowerCase() === 'false')
        if (created.length > 1) throw new LocalError('FULL_APPLICATION_IDENTITY_AMBIGUOUS')
        for (const container of created) {
          state.foundation.verifyContainer(container, service)
          if (neverStarted(container)) {
            state.createdStopped ??= new Map()
            state.createdStopped.set(container.Id, { id: container.Id, service })
          } else if (container.State.Running || Date.parse(container.State.StartedAt) > 0) {
            // StartedAt proves this exact new container ran even if it exited
            // before the first running sample. It is not a never-started retry.
            state.foundation.started.set(container.Id, { id: container.Id, service })
          }
        }
        lock.update({ resources: fullSnapshot(state) })
      }
    }
    await ready(state, !prepared.adminUserId); await verifyClients()
    const resources = fullOwnedResources(state, prior, prepared.volumes, { stopped: false })
    save({ persistent: true, state: prepared.adminUserId ? 'ready' : 'awaiting-bootstrap', resources,
      managedApplications: [...resources.started, ...resources.createdStopped].filter(item => applications.includes(item.service)), gatewayDigest: gatewayDigest() })
  } catch (error) {
    try {
      state.foundation.restore(fullOwnedResources(state, prior, prepared.volumes, { stopped: false }), prepared.volumes)
      await state.foundation.stopStarted()
      const resources = fullOwnedResources(state, prior, prepared.volumes)
      save({ persistent: false, state: 'stopped', stoppedAt: new Date().toISOString(), resources,
        managedApplications: [...resources.started, ...resources.createdStopped].filter(item => applications.includes(item.service)), gatewayDigest: gatewayDigest() })
    } catch (cleanupError) {
      // Keep the original live mutex/journal. Never certify a partial cleanup as stopped.
      lock.update({ state: 'cleanup-failed', cleanupRequired: true, resources: fullSnapshot(state) })
      throw cleanupError
    }
    lock.release()
    throw error
  }
}
export async function fullDownRuntime(state, prior, preparedVolumes, { modeRecordPath = modePath } = {}) {
  if (prior.fingerprint !== state.fingerprint) throw new LocalError('FULL_CONFIGURATION_CHANGED')
  if (digest(state.foundation.verifyVolumes()) !== digest(preparedVolumes)) throw new LocalError('LOCAL_VOLUME_IDENTITY_CHANGED')
  state.foundation.restore(prior.resources, preparedVolumes)
  if (prior.stoppedAt) {
    // Stopped down is idempotent and readonly: restarted or unknown resources refuse.
    fullOwnedResources(state, prior, preparedVolumes)
    return
  }
  await pauseContainers(state, prior.managedApplications)
  await state.foundation.stopStarted()
  const resources = fullOwnedResources(state, prior, preparedVolumes)
  atomicJson(modeRecordPath, { ...prior, resources, state: 'stopped', stoppedAt: new Date().toISOString() })
}
export async function legacyCommand(command, mode, adminUserId, context = {}) {
  // Internal dependency seam; the CLI supplies no context and uses only the
  // fixed repository configuration. Fixtures cannot add a user bypass flag.
  const directory = context.directory ?? localRoot
  const modePath = join(directory, 'mode.json'), initializedPath = join(directory, 'initialized.json')
  const gatewayTemplate = context.gatewayTemplate ?? join(directory, 'runtime-gateway.template')
  const makeRuntime = context.runtime ?? runtime, readValues = context.valuesFor ?? valuesFor
  const checkExternal = context.externalCheck ?? externalCheck
  const persist = context.persist ?? atomicJson
  if (command === 'configure') {
    const lock = acquireLock({ mode: 'dev', fingerprint: 'legacy-configure', directory, externalCheck: checkExternal })
    try { configure(); console.log('LEGACY_CONFIGURED; no database writes') } finally { lock.release() }
    return
  }
  mode ??= command === 'up' ? 'full' : ['bootstrap', 'down'].includes(command) ? activeMode({ allowStopped: command === 'down' }) : 'dev'
  if (command === 'dev' && mode !== 'dev' || command === 'up' && mode !== 'full') throw new LocalError('LEGACY_COMMAND_MODE_INVALID')
  const values = readValues(mode)
  await (context.assertHosts ?? assertHosts)()
  const control = context.control ?? ((action, selectedMode, id) => controlRequest(action, selectedMode, id, { directory }))
  if (command === 'bootstrap' && mode === 'dev' && await control('bootstrap', mode, adminUserId)) return
  if (command === 'down' && mode === 'dev' && await control('stop', mode)) return
  const persistentPath = join(directory, 'mode-lock.json')
  if (command === 'down') {
    const state = makeRuntime(mode, values, { generate: false })
    let registry
    const select = prior => {
      const value = prior?.recovery ?? prior ?? readJson(modePath, 'LEGACY_OWNER_RECORD_MISSING')
      if (value.version !== 1 || value.mode !== mode || !validUuid(value.runId) || value.fingerprint !== state.fingerprint ||
          !value.identity?.pid || !value.identity.creation || !value.identity.executable || !value.identity.commandDigest ||
          !value.resources || !Array.isArray(value.resources.started) || !Array.isArray(value.resources.preRunning) || !Array.isArray(value.resources.containerProofs))
        throw new LocalError('LEGACY_RECOVERY_PROVENANCE_INVALID')
      if (value.gatewayDigest !== digest(readFileSync(gatewayTemplate, 'utf8'))) throw new LocalError('FULL_CONFIGURATION_CHANGED')
      const prepared = readJsonOptional(initializedPath)
      const partial = !prepared && value.preparation?.version === 1 && ['init', 'migrate'].includes(value.preparation.command) && value.preparation.partial === true
      if (partial ? value.preparation.secretFingerprint !== secretFingerprint(values) : !prepared || prepared.version !== 1 || prepared.secretFingerprint !== secretFingerprint(values))
        throw new LocalError('LEGACY_PREPARED_TARGET_CHANGED')
      const volumes = partial ? value.preparedVolumes : prepared.volumes
      if (!Array.isArray(volumes) || value.preparedVolumes && digest(value.preparedVolumes) !== digest(volumes)) throw new LocalError('LOCAL_VOLUME_IDENTITY_CHANGED')
      return { ...value, preparedVolumes: volumes, partialPreparation: partial }
    }
    const verify = () => {
      if (registry.state !== 'stopped' && identityAlive(registry.identity)) throw new LocalError('MODE_ACTIVE')
      for (const child of registry.children ?? []) if (identityAlive(child.identity)) throw new LocalError('MODE_CHILDREN_STILL_ACTIVE')
      if (registry.temporaryContainer || registry.temporaryName) verifyTemporaryGroup(state, registry)
      else state.foundation.restore(registry.resources, registry.preparedVolumes, { partial: registry.partialPreparation })
      if (registry.state === 'stopped' && [...registry.resources.started, ...(registry.resources.createdStopped ?? [])]
        .some(item => state.foundation.inspect(item.id)?.State.Running)) throw new LocalError('STOPPED_RESOURCE_RESTARTED')
      persist(join(directory, 'retired-legacy-run.json'), registry)
    }
    const lock = acquireLock({ mode, fingerprint: state.fingerprint, directory, recoverCleanup: prior => {
      registry = select(prior); return { recovery: registry, resources: registry.resources, preparedVolumes: registry.preparedVolumes }
    }, externalCheck: verify })
    try {
      lock.update({ cleanupRequired: true, state: 'stopping', recovery: registry, resources: registry.resources })
      persist(modePath, { ...registry, state: 'stopping', cleanupRequired: true })
      if (registry.temporaryContainer || registry.temporaryName) {
        cleanupTemporary(state, registry)
        state.foundation.restore(registry.resources, registry.preparedVolumes)
      }
      await state.foundation.stopStarted()
      state.foundation.restore(registry.resources, registry.preparedVolumes, { partial: registry.partialPreparation })
      state.foundation.verifyStopped()
      persist(modePath, { ...registry, temporaryContainer: null, temporaryProof: null, temporaryName: null, temporaryExpectedImage: null, temporarySourceId: null,
        resources: state.foundation.snapshot(), state: 'stopped', stoppedAt: new Date().toISOString(), cleanupRequired: false, persistent: false })
      lock.update({ state: 'stopped', cleanupRequired: false }); lock.release()
      return
    } catch (error) {
      try { lock.update({ state: 'cleanup-failed', cleanupRequired: true, recovery: registry, resources: registry.resources }) } catch {}
      throw error
    }
  }
  let lock, state, prior
  if (['bootstrap', 'down'].includes(command) && mode === 'full') {
    if (!existsSync(persistentPath) && command === 'down') {
      prior = readJson(modePath, 'FULL_OWNER_RECORD_MISSING')
      if (!prior.stoppedAt || prior.mode !== 'full' || prior.state !== 'stopped') throw new LocalError('FULL_OWNER_RECORD_INVALID')
      lock = acquireLock({ mode, fingerprint: prior.fingerprint, externalCheck })
      try {
        state = runtime(mode, values, { generate: false })
        if (prior.gatewayDigest !== digest(readFileSync(gatewayTemplate, 'utf8'))) throw new LocalError('FULL_CONFIGURATION_CHANGED')
        state.foundation.started = new Map(prior.resources.started.map(item => [item.id, item]))
        state.foundation.proofs = new Map(prior.resources.containerProofs.map(proof => [proof.id, proof]))
        state.foundation.preRunning = new Map(prior.resources.preRunning.map(item => [item.id, item]))
        await fullDownRuntime(state, prior, readJson(initializedPath).volumes)
        lock.release()
        return
      } catch (error) { lock.update({ state: 'cleanup-failed' }); throw error }
    }
    if (!existsSync(persistentPath)) throw new LocalError('FULL_OWNER_RECORD_MISSING')
    prior = readJson(persistentPath)
    if (!prior.persistent || prior.mode !== 'full') throw new LocalError('FULL_OWNER_RECORD_INVALID')
    state = runtime(mode, values, { generate: false })
    if (prior.fingerprint !== state.fingerprint || prior.gatewayDigest !== digest(readFileSync(gatewayTemplate, 'utf8'))) throw new LocalError('FULL_CONFIGURATION_CHANGED')
    const operation = acquireLock({ mode, fingerprint: state.fingerprint, name: 'operation-lock.json' })
    lock = { record: prior, update(extra) { Object.assign(prior, extra); atomicJson(persistentPath, prior); atomicJson(modePath, prior) }, release: () => operation.release() }
    state.foundation.started = new Map(prior.resources.started.map(item => [item.id, item]))
    state.foundation.preRunning = new Map(prior.resources.preRunning.map(item => [item.id, item]))
    state.foundation.proofs = new Map((prior.resources.containerProofs ?? []).map(proof => [proof.id, proof]))
  } else {
    lock = acquireLock({ mode, fingerprint: digest(values), directory, externalCheck: checkExternal })
    try {
      state = makeRuntime(mode, values, { ready: !!readJsonOptional(initializedPath)?.adminUserId })
      lock.update({ fingerprint: state.fingerprint })
    } catch (error) { lock.release(); throw error }
  }
  let handedOff = false, cleanupArmed = false, originalError
  const saveMode = extra => { atomicJson(modePath, { ...lock.record, ...extra }); lock.update(extra) }
  const armCleanup = (volumes, preparation) => {
    lock.update({ cleanupRequired: true, resources: state.foundation.snapshot(), preparedVolumes: volumes,
      gatewayDigest: digest(readFileSync(gatewayTemplate, 'utf8')), ...(preparation ? { preparation } : {}) })
    cleanupArmed = true
  }
  const recordResources = resources => {
    lock.update({ resources })
    if (lock.record.preparation?.partial) {
      const before = lock.record.preparedVolumes, current = state.foundation.verifyVolumes(false)
      for (const original of before) if (!current.some(volume => volume.name === original.name && digest(volume) === digest(original)))
        throw new LocalError('LOCAL_VOLUME_IDENTITY_CHANGED')
      state.foundation.verifyVolumeInventory()
      const added = current.filter(volume => !before.some(original => original.name === volume.name))
      if (added.length) {
        const mounted = new Set(), proofs = new Map(resources.containerProofs.map(proof => [proof.id, proof]))
        for (const item of [...resources.started, ...(resources.createdStopped ?? [])]) {
          const actual = state.foundation.inspect(item.id)
          if (!actual) continue
          state.foundation.verifyRecordedContainer(actual, proofs.get(item.id))
          for (const mount of actual.Mounts) if (mount.Type === 'volume') mounted.add(mount.Name)
        }
        if (added.some(volume => !mounted.has(volume.name))) throw new LocalError('LOCAL_VOLUME_OWNER_UNKNOWN')
      }
      lock.update({ preparedVolumes: current })
    }
  }
  try {
    if (['init', 'migrate'].includes(command)) {
      if (existsSync(initializedPath)) (context.initialized ?? initialized)(state)
      else state.foundation.preflight(command === 'migrate')
      const partial = !existsSync(initializedPath)
      armCleanup(state.foundation.verifyVolumes(!partial), { version: 1, command, partial, secretFingerprint: secretFingerprint(values) })
      lock.update({ state: 'preparing' })
      await state.foundation.start(['postgres', 'redis'], { onChange: recordResources })
      state.foundation.compose(['run', '--rm', '--no-deps', 'hydra', 'migrate', 'sql', 'up', '--read-from-env', '--yes'])
      const full = runtime('full', valuesFor('full'), { generate: true, ready: false })
      full.foundation.compose(['run', '--rm', '--no-deps', '--build', 'server', 'node', 'dist/db/migrate.js'])
      full.foundation.compose(['run', '--rm', '--no-deps', '--build', 'outline', 'yarn', 'db:migrate', '--env', 'production-ssl-disabled'])
      atomicJson(initializedPath, { version: 1, secretFingerprint: secretFingerprint(values), volumes: state.foundation.verifyVolumes(),
        createdAt: new Date().toISOString(), ...(readJsonOptional(initializedPath)?.adminUserId ? { adminUserId: readJson(initializedPath).adminUserId } : {}) })
      console.log('LEGACY_INITIALIZED')
    } else if (command === 'dev') {
      const dev = context.dev ?? {}, tools = dev.tools ?? toolchain({ legacy: true }), prepared = (context.initialized ?? initialized)(state)
      lock.update({ preparedVolumes: prepared.volumes, gatewayDigest: digest(readFileSync(gatewayTemplate, 'utf8')) })
      state.foundation.preflight()
      if (dev.assertPorts) await dev.assertPorts()
      else {
        for (const spec of devProcesses(values, { node: tools.node }).filter(spec => ['web', 'server', 'outline'].includes(spec.name)))
          await assertPortFree(Number(spec.environment.SERVER_PORT || spec.environment.INTEGRATION_WEB_PORT || spec.environment.PORT))
        await assertPortFree(Number(values.OUTLINE_HTTP_PORT)); await assertPortFree(Number(hostPort(values.OUTLINE_STATIC_UPSTREAM))); await assertPortFree(8090)
      }
      armCleanup(prepared.volumes)
      await state.foundation.start(['postgres', 'redis', 'hydra'], { onChange: recordResources })
      // Issuer verification requires the gateway for normal ready starts only.
      const gatewayWriter = dev.writeGateway ?? writeGateway
      gatewayWriter(!!prepared.adminUserId, 'dev')
      lock.update({ gatewayDigest: digest(readFileSync(gatewayTemplate, 'utf8')) })
      await state.foundation.start(['gateway'], { onChange: recordResources })
      const ready = await (dev.checkPrepared ?? checkPreparedDev)(state, tools)
      saveMode({ state: ready ? 'starting' : 'awaiting-bootstrap', identity: lock.record.identity })
      handedOff = true
      await supervise({ mode, fingerprint: state.fingerprint, directory, controlDirectory: directory, lock, foundation: state.foundation,
        specifications: dev.specifications ?? devProcesses(values, { node: tools.node }).map(spec => ({ ...spec, command: tools.node, args: [tools.corepack, ...spec.args] })),
        awaitingBootstrap: !ready, banner: 'LEGACY_READY http://exwebsite.test:8090/',
        readiness: async (children, limited) => {
          // During bootstrap the gateway belongs to this run and stays paused with applications.
          if (!state.foundation.containers().some(item => item.Config.Labels['com.docker.compose.service'] === 'gateway' && item.State.Running))
            await state.foundation.start(['gateway'])
          await (dev.readiness ?? readinessDev)(state, children, limited)
          saveMode({ state: limited ? 'awaiting-bootstrap' : 'ready', gatewayDigest: digest(readFileSync(gatewayTemplate, 'utf8')) })
        },
        onPause: async () => {
          const gateway = state.foundation.containers().filter(item => item.Config.Labels['com.docker.compose.service'] === 'gateway').map(item => ({ id: item.Id, service: 'gateway' }))
          for (const item of gateway) if (!state.foundation.started.has(item.id)) throw new LocalError('GATEWAY_OWNER_UNKNOWN')
          await pauseContainers(state, gateway)
        },
        prepare: id => (dev.prepare ?? bootstrapDev)(state, tools, lock, id),
      })
    } else if (command === 'up') {
      const prepared = (context.initialized ?? initialized)(state)
      handedOff = true
      await fullUpRuntime(state, lock, prepared, { modeRecordPath: modePath, gatewayDigest: () => digest(readFileSync(gatewayTemplate, 'utf8')), ...context.fullUp })
      console.log(prepared.adminUserId ? 'LEGACY_READY http://exwebsite.test:8090/' : 'INTEGRATION_AWAITING_BOOTSTRAP; Website available; Outline NOT_READY')
    } else if (command === 'bootstrap') {
      if (mode !== 'full' || !validUuid(adminUserId)) throw new LocalError('LEGACY_BOOTSTRAP_ARGUMENTS_INVALID')
      initialized(state)
      await prepareFullRuntime(state, lock, adminUserId)
      console.log('LEGACY_BOOTSTRAP_READY')
      handedOff = true
    } else if (command === 'down') {
      if (mode !== 'full') throw new LocalError('LEGACY_SUPERVISOR_NOT_RUNNING')
      await fullDownRuntime(state, prior, readJson(initializedPath).volumes)
      const { rmSync } = await import('node:fs'); rmSync(persistentPath)
    } else throw new LocalError('LEGACY_COMMAND_INVALID')
  } catch (error) { originalError = error; throw error }
  finally {
    if (!handedOff && !['bootstrap', 'down'].includes(command) && cleanupArmed) {
      try {
        lock.update({ state: 'stopping', cleanupRequired: true, resources: state.foundation.snapshot() })
        persist(modePath, lock.record)
        const resources = lock.record.resources, volumes = lock.record.preparedVolumes
        const partial = lock.record.preparation?.partial === true && !existsSync(initializedPath)
        state.foundation.restore(resources, volumes, { partial })
        await state.foundation.stopStarted()
        state.foundation.restore(resources, volumes, { partial }); state.foundation.verifyStopped()
        const stopped = { state: 'stopped', stoppedAt: new Date().toISOString(), cleanupRequired: false, resources }
        persist(modePath, { ...lock.record, ...stopped }); lock.update(stopped); lock.release()
      } catch (cleanupError) {
        try { lock.update({ state: 'cleanup-failed', cleanupRequired: true }); persist(modePath, lock.record) } catch {}
        if (!originalError) throw cleanupError
        originalError.cleanupError = cleanupError
      }
    } else if (!handedOff || mode === 'full' && command === 'bootstrap') lock.release()
    if (command === 'dev' && handedOff) atomicJson(modePath, { ...lock.record, ...(lock.record.state === 'stopped' ? { stoppedAt: new Date().toISOString() } : {}) })
  }
}
function readJsonOptional(path) { return existsSync(path) ? readJson(path) : undefined }
