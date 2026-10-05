import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseEnv } from 'node:util'
import { root, localRoot, resolveExuiSource } from './configure.mjs'

export const localDirectory = join(localRoot, 'local-dev')
export const defaults = Object.freeze({ public: 8080, web: 8081, api: 8082, outline: 3102,
  outlineVite: 3101, postgres: 17432, redis: 17379, hydraPublic: 14444, hydraAdmin: 14447 })
export const secretNames = Object.freeze(['POSTGRES_PASSWORD', 'OUTLINE_PASSWORD', 'HYDRA_PASSWORD',
  'OUTLINE_SECRET_KEY', 'OUTLINE_UTILS_SECRET', 'HYDRA_SYSTEM_SECRET', 'OUTLINE_INTEGRATION_KEY',
  'IDENTITY_BOOTSTRAP_KEY', 'IDENTITY_DELIVERY_KEY', 'IDENTITY_FLOW_KEY', 'OUTLINE_OIDC_CLIENT_SECRET'])
export class LocalError extends Error {
  constructor(code, next = 'pnpm infra configure') {
    super(`${code}; next: ${next}`); this.code = code
  }
}
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex')
export function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  renameSync(temporary, path)
}
export function readJson(path, code = 'LOCAL_CONFIG_INVALID') {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { throw new LocalError(code) }
}
export function websiteEnvironment(workspace = root, inherited = process.env) {
  const file = join(workspace, 'apps/server/.env.local')
  try { return { ...(existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}), ...inherited } }
  catch { throw new LocalError('WEBSITE_ENV_INVALID') }
}
export function websiteTarget(environment) {
  let url
  try { url = new URL(environment.DATABASE_URL) } catch { throw new LocalError('WEBSITE_DATABASE_INVALID') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || decodeURIComponent(url.pathname) !== '/exre' ||
      !url.hostname || !url.username || url.hash) throw new LocalError('WEBSITE_DATABASE_INVALID')
  if (!environment.AUTH_CODE_HMAC_KEY) throw new LocalError('WEBSITE_AUTH_KEY_MISSING')
  return Object.freeze({ host: url.hostname.toLowerCase(), port: Number(url.port || 5432), database: 'exre',
    user: decodeURIComponent(url.username), verifiedDatabase: 'exre' })
}
export async function verifyWebsiteDatabase(environment) {
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: environment.DATABASE_URL, connectionTimeoutMillis: 3000 })
  try {
    await client.connect()
    await client.query('BEGIN READ ONLY')
    const result = await client.query('SELECT current_database() AS name')
    if (result.rows[0]?.name !== 'exre') throw new Error()
    await client.query('ROLLBACK')
  } catch { throw new LocalError('WEBSITE_DATABASE_UNAVAILABLE', 'check original Website DATABASE_URL; then pnpm infra configure') }
  finally { await client.end().catch(() => {}) }
}
export function validateConfig(config, workspace = root, directory = localDirectory) {
  if (!config || config.version !== 1 || config.mode !== 'local' || !config.ports || typeof config.ports !== 'object' || Array.isArray(config.ports) ||
      JSON.stringify(Object.keys(config.ports).sort()) !== JSON.stringify(Object.keys(defaults).sort())) throw new LocalError('LOCAL_CONFIG_INVALID')
  for (const port of Object.values(config.ports)) {
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new LocalError('LOCAL_PORT_INVALID')
  }
  if (new Set(Object.values(config.ports)).size !== Object.keys(defaults).length) throw new LocalError('LOCAL_PORT_CONFLICT')
  const expected = derived(config.ports)
  for (const [key, value] of Object.entries(expected)) if (config[key] !== value) throw new LocalError('LOCAL_LAYOUT_INVALID')
  if (config.storage !== join(directory, 'data/outline') || config.project !== 'exwebsite-local-dev' ||
      config.websiteTarget?.database !== 'exre' || config.websiteTarget?.verifiedDatabase !== 'exre' ||
      typeof config.websiteTarget?.host !== 'string' || typeof config.websiteTarget?.user !== 'string' ||
      !Number.isSafeInteger(config.websiteTarget?.port)) throw new LocalError('LOCAL_TARGET_INVALID')
  return Object.freeze({ ...config, ports: Object.freeze({ ...config.ports }), websiteTarget: Object.freeze({ ...config.websiteTarget }) })
}
function derived(ports) {
  return { publicOrigin: `http://127.0.0.1:${ports.public}`, issuer: `http://127.0.0.1:${ports.hydraPublic}/`,
    callback: `http://127.0.0.1:${ports.public}/docs/auth/oidc.callback`, clientId: 'ex-outline-local' }
}
export function readSecrets(path) {
  let secrets
  try { secrets = parseEnv(readFileSync(path, 'utf8')) } catch { throw new LocalError('LOCAL_SECRETS_INVALID') }
  if (JSON.stringify(Object.keys(secrets).sort()) !== JSON.stringify([...secretNames].sort()) ||
      secretNames.some(key => !/^[0-9a-f]{64}$/.test(secrets[key]))) throw new LocalError('LOCAL_SECRETS_INVALID')
  return Object.freeze(secrets)
}
export function validatePortEnvironment(config, environment) {
  const assertions = { WEBSITE_DEV_ENTRY_PORT: 'public', WEBSITE_DEV_WEB_PORT: 'web', WEBSITE_DEV_API_PORT: 'api',
    INTEGRATION_WEB_PORT: 'web', INTEGRATION_SERVER_PORT: 'api', OUTLINE_DEV_HTTP_PORT: 'outline',
    INTEGRATION_OUTLINE_PORT: 'outline', INTEGRATION_OUTLINE_VITE_PORT: 'outlineVite' }
  for (const [key, field] of Object.entries(assertions)) if (environment[key] !== undefined &&
      environment[key] !== String(config.ports[field])) throw new LocalError('LOCAL_STALE_PORT_ENV')
  const urls = { SERVER_PUBLIC_WEB_BASE_URL: config.publicOrigin, HYDRA_PUBLIC_URL: config.issuer,
    HYDRA_ADMIN_URL: `http://127.0.0.1:${config.ports.hydraAdmin}/`,
    OUTLINE_INTERNAL_URL: `http://127.0.0.1:${config.ports.outline}/`,
    WEBSITE_INTERNAL_URL: `http://127.0.0.1:${config.ports.api}/`, OUTLINE_OIDC_CLIENT_ID: config.clientId,
    OUTLINE_OIDC_REDIRECT_URI: config.callback, WEBSITE_INTEGRATION_MODE: 'local' }
  for (const [key, value] of Object.entries(urls)) if (environment[key] !== undefined && environment[key] !== value)
    throw new LocalError('LOCAL_STALE_IDENTITY_ENV')
}
export function loadLocal({ workspace = root, directory = localDirectory, inherited = process.env, checkEnvironment = true } = {}) {
  const config = validateConfig(readJson(join(directory, 'config.json')), workspace, directory)
  const secrets = readSecrets(join(directory, 'secrets.env'))
  const website = websiteEnvironment(workspace, inherited)
  if (digest(websiteTarget(website)) !== digest(config.websiteTarget)) throw new LocalError('WEBSITE_TARGET_CHANGED')
  if (checkEnvironment) validatePortEnvironment(config, inherited)
  const fingerprint = digest({ config, secrets })
  return { config, secrets, website, fingerprint, directory, workspace }
}
export function toolchain({ workspace = root, inherited = process.env, legacy = false } = {}) {
  const node = inherited.INTEGRATION_NODE_BIN || (legacy
    ? join(localRoot, 'tools/node26/node-v26.3.0-win-x64/node.exe') : process.execPath)
  const corepack = inherited.INTEGRATION_COREPACK_JS || join(dirname(process.execPath), 'node_modules/corepack/dist/corepack.js')
  if (!existsSync(node) || !existsSync(corepack)) throw new LocalError('LOCAL_TOOLS_MISSING', 'set INTEGRATION_NODE_BIN / INTEGRATION_COREPACK_JS')
  const version = spawnSync(node, ['--version'], { encoding: 'utf8', shell: false })
  const outline = readJson(join(workspace, 'apps/outline/package.json'))
  try {
    const semver = createRequire(join(workspace, 'apps/outline/package.json'))('semver')
    if (version.status !== 0 || !semver.satisfies(version.stdout.trim(), outline.engines.node) ||
        (legacy && version.stdout.trim() !== 'v26.3.0')) throw new Error()
  } catch { throw new LocalError('LOCAL_NODE_UNSUPPORTED', 'set INTEGRATION_NODE_BIN to a Node supported by apps/outline/package.json') }
  for (const script of ['dev:watch:integration', 'integration:check', 'integration:bootstrap']) {
    if (!outline.scripts?.[script]) throw new LocalError('OUTLINE_INTEGRATION_MISSING')
  }
  if (!existsSync(join(workspace, 'node_modules')) || !existsSync(join(workspace, 'apps/outline/node_modules')))
    throw new LocalError('LOCAL_DEPENDENCIES_MISSING', 'pnpm install; then install apps/outline with Corepack Yarn')
  if (spawnSync(node, [corepack, 'yarn', '--version'], { cwd: join(workspace, 'apps/outline'), encoding: 'utf8', shell: false }).status !== 0)
    throw new LocalError('LOCAL_COREPACK_UNAVAILABLE')
  const link = join(workspace, 'vendor/exui')
  const consumer = join(workspace, 'apps/outline/node_modules/@exre/exui')
  const source = inherited.EXUI_SOURCE_DIR || (existsSync(link) ? undefined :
    existsSync(consumer) ? resolve(realpathSync(consumer), '../..') : undefined)
  try { resolveExuiSource(source, link) } catch { throw new LocalError('LOCAL_EXUI_ARTIFACTS_MISSING', 'build the existing ExUI checkout; preserve its links') }
  return Object.freeze({ node, corepack })
}
export async function configureLocal({ ports = {}, workspace = root, directory = localDirectory, inherited = process.env,
  validateTools = toolchain, verifyDatabase = verifyWebsiteDatabase } = {}) {
  validateTools({ workspace, inherited })
  const website = websiteEnvironment(workspace, inherited)
  const target = websiteTarget(website)
  await verifyDatabase(website)
  const configPath = join(directory, 'config.json'), secretsPath = join(directory, 'secrets.env')
  const existingConfig = existsSync(configPath), existingSecrets = existsSync(secretsPath)
  if (existingConfig !== existingSecrets) throw new LocalError('LOCAL_CONFIG_PARTIAL')
  const old = existingConfig ? validateConfig(readJson(configPath), workspace, directory) : undefined
  const selectedPorts = { ...(old?.ports ?? defaults), ...ports }
  const config = validateConfig({ version: 1, mode: 'local', project: 'exwebsite-local-dev', ports: selectedPorts,
    ...derived(selectedPorts), storage: join(directory, 'data/outline'), websiteTarget: target }, workspace, directory)
  const secrets = existingSecrets ? readSecrets(secretsPath) : Object.fromEntries(secretNames.map(key => [key, randomBytes(32).toString('hex')]))
  mkdirSync(directory, { recursive: true })
  if (!existingSecrets) writeFileSync(secretsPath, secretNames.map(key => `${key}=${secrets[key]}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' })
  atomicJson(configPath, config)
  mkdirSync(config.storage, { recursive: true })
  return { config, secrets, website, fingerprint: digest({ config, secrets }), workspace, directory }
}
/** Explicit complete original targets only; never substitute the current mode's keys. */
export function otherOutboxTargets(currentMode, workspace = root, inherited = process.env) {
  const targets = {}
  const legacyFile = join(workspace, '.local/docs-integration/dev.env')
  const originalLocalDirectory = join(workspace, '.local/docs-integration/local-dev')
  if (currentMode === 'local' && existsSync(legacyFile)) {
    const legacy = parseEnv(readFileSync(legacyFile, 'utf8'))
    const upstream = /^host\.docker\.internal:([1-9]\d{0,4})$/.exec(legacy.OUTLINE_BACKEND_UPSTREAM ?? '')
    const complete = [...secretNames, 'EXRE_PASSWORD', 'AUTH_CODE_HMAC_KEY', 'OIDC_PROBE_CLIENT_SECRET'].every(key => /^[0-9a-f]{64}$/.test(legacy[key] ?? '')) &&
      ['WEBSITE_SERVER_UPSTREAM', 'WEBSITE_WEB_UPSTREAM', 'OUTLINE_STATIC_UPSTREAM', 'OUTLINE_DIRECT_UPSTREAM'].every(key => /^host\.docker\.internal:([1-9]\d{0,4})$/.test(legacy[key] ?? '')) &&
      legacy.OUTLINE_HTTP_PORT === upstream?.[1]
    if (complete && upstream && Number(upstream[1]) <= 65535) {
      targets['ex-outline'] = { hydraAdminUrl: 'http://127.0.0.1:14445/', outlineInternalUrl: `http://127.0.0.1:${upstream[1]}/`, deliveryKey: legacy.IDENTITY_DELIVERY_KEY }
      targets['ex-oidc-probe'] = { hydraAdminUrl: 'http://127.0.0.1:14445/' }
    }
  } else if (currentMode !== 'local' && existsSync(join(originalLocalDirectory, 'config.json')) && existsSync(join(originalLocalDirectory, 'secrets.env'))) {
    const original = validateConfig(readJson(join(originalLocalDirectory, 'config.json')), workspace, originalLocalDirectory)
    const secrets = readSecrets(join(originalLocalDirectory, 'secrets.env'))
    const transportHost = currentMode === 'full' ? 'host.docker.internal' : '127.0.0.1'
    targets['ex-outline-local'] = { hydraAdminUrl: `http://${transportHost}:${original.ports.hydraAdmin}/`,
      outlineInternalUrl: `http://${transportHost}:${original.ports.outline}/`, deliveryKey: secrets.IDENTITY_DELIVERY_KEY }
  }
  if (inherited.IDENTITY_OUTBOX_TARGETS_JSON) {
    let explicit
    try { explicit = JSON.parse(inherited.IDENTITY_OUTBOX_TARGETS_JSON) } catch { throw new LocalError('OUTBOX_TARGETS_INVALID') }
    Object.assign(targets, explicit)
  }
  return Object.keys(targets).length ? JSON.stringify(targets) : undefined
}
export function localEnvironments(state, inherited = process.env) {
  if (state.environments) return state.environments
  const { config: c, secrets: s, website: w } = state, p = c.ports
  const common = { ...inherited, ...s, WEBSITE_INTEGRATION_ENABLED: 'true', WEBSITE_INTEGRATION_MODE: 'local',
    HYDRA_PUBLIC_URL: c.issuer, HYDRA_ADMIN_URL: `http://127.0.0.1:${p.hydraAdmin}/`,
    OUTLINE_INTERNAL_URL: `http://127.0.0.1:${p.outline}/`, WEBSITE_INTERNAL_URL: `http://127.0.0.1:${p.api}/`,
    OUTLINE_OIDC_CLIENT_ID: c.clientId, OUTLINE_OIDC_REDIRECT_URI: c.callback }
  const targets = otherOutboxTargets('local', state.workspace, inherited)
  if (targets) common.IDENTITY_OUTBOX_TARGETS_JSON = targets
  else delete common.IDENTITY_OUTBOX_TARGETS_JSON
  return {
    server: { ...w, ...common, DATABASE_URL: w.DATABASE_URL, AUTH_CODE_HMAC_KEY: w.AUTH_CODE_HMAC_KEY,
      SERVER_HOST: '127.0.0.1', SERVER_PORT: String(p.api), SERVER_PUBLIC_WEB_BASE_URL: c.publicOrigin,
      SERVER_PUBLIC_AVATAR_BASE_URL: `${c.publicOrigin}/api/avatars` },
    web: { ...common, WEBSITE_DEV_ENTRY_PORT: String(p.public), INTEGRATION_WEB_PORT: String(p.web),
      INTEGRATION_SERVER_PORT: String(p.api), OUTLINE_DEV_HTTP_PORT: String(p.outline),
      INTEGRATION_OUTLINE_VITE_PORT: String(p.outlineVite), SERVER_PUBLIC_WEB_BASE_URL: c.publicOrigin },
    outline: { ...common, NODE_ENV: 'development', URL: `${c.publicOrigin}/docs`, WEBSITE_URL: `${c.publicOrigin}/`,
      PORT: String(p.outline), INTEGRATION_OUTLINE_VITE_PORT: String(p.outlineVite), FORCE_HTTPS: 'false',
      SECRET_KEY: s.OUTLINE_SECRET_KEY, UTILS_SECRET: s.OUTLINE_UTILS_SECRET,
      DATABASE_URL: `postgres://outline:${s.OUTLINE_PASSWORD}@127.0.0.1:${p.postgres}/outline`,
      DATABASE_CONNECTION_POOL_URL: '', DATABASE_SCHEMA: 'public', PGSSLMODE: 'disable',
      REDIS_URL: `redis://127.0.0.1:${p.redis}`, REDIS_COLLABORATION_URL: `redis://127.0.0.1:${p.redis}`,
      FILE_STORAGE: 'local', FILE_STORAGE_LOCAL_ROOT_DIR: c.storage, SSL_CERT_FILE: '', SSL_KEY_FILE: '' },
    compose: { ...inherited, ...s, LOCAL_POSTGRES_PORT: String(p.postgres), LOCAL_REDIS_PORT: String(p.redis),
      LOCAL_HYDRA_PUBLIC_PORT: String(p.hydraPublic), LOCAL_HYDRA_ADMIN_PORT: String(p.hydraAdmin),
      LOCAL_PUBLIC_ORIGIN: c.publicOrigin, LOCAL_ISSUER: c.issuer, LOCAL_CONFIG_FINGERPRINT: state.fingerprint },
  }
}
