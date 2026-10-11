import { existsSync, readFileSync } from 'node:fs'
import { join, dirname, delimiter, isAbsolute } from 'node:path'
import { parseEnv } from 'node:util'
import { root } from './shared.mjs'
import { RuntimeError } from './output.mjs'
import { digest } from '../docs-integration/local-config.mjs'

export const defaults = Object.freeze({ public: 8080, web: 8081, api: 8082, outline: 3102,
  outlineVite: 3101, postgres: 5432, redis: 6379, hydraPublic: 4444, hydraAdmin: 4445 })
export const portKeys = Object.freeze({ public: 'LOCAL_PUBLIC_PORT', web: 'LOCAL_WEB_PORT', api: 'LOCAL_API_PORT',
  outline: 'LOCAL_OUTLINE_PORT', outlineVite: 'LOCAL_OUTLINE_VITE_PORT', postgres: 'LOCAL_POSTGRES_PORT',
  redis: 'LOCAL_REDIS_PORT', hydraPublic: 'LOCAL_HYDRA_PUBLIC_PORT', hydraAdmin: 'LOCAL_HYDRA_ADMIN_PORT' })
const cryptoKeys = ['AUTH_CODE_HMAC_KEY', 'OUTLINE_SECRET_KEY', 'OUTLINE_UTILS_SECRET', 'HYDRA_SYSTEM_SECRET',
  'OUTLINE_INTEGRATION_KEY', 'IDENTITY_BOOTSTRAP_KEY', 'IDENTITY_DELIVERY_KEY', 'IDENTITY_FLOW_KEY']
export const websiteKeys = ['SERVER_AVATAR_DIRECTORY', 'SERVER_CORS_ALLOWED_ORIGINS', 'SERVER_PUBLIC_AVATAR_BASE_URL',
  'STORAGE_DEFAULT_ADAPTER', 'STORAGE_MAX_BYTES', 'STORAGE_PUBLIC_API_BASE_URL', 'STORAGE_UPLOAD_HMAC_KEY',
  'SERVER_NOTIFICATION_TOKEN_KEY', 'TENCENT_COS_BUCKET', 'TENCENT_COS_REGION', 'TENCENT_COS_SECRET_ID', 'TENCENT_COS_SECRET_KEY']
const databaseFields = ['HOST', 'PORT', 'NAME', 'USER', 'PASSWORD', 'SSLMODE', 'SSLROOTCERT', 'CONNECT_TIMEOUT', 'OPTIONS']
const databasePrefixes = ['DATABASE', 'OUTLINE_DATABASE', 'HYDRA_DATABASE']
export const supportedKeys = Object.freeze([...cryptoKeys, ...websiteKeys, ...Object.values(portKeys),
  ...databasePrefixes.flatMap(prefix => databaseFields.map(field => `${prefix}_${field}`)),
  'RUNTIME_PROFILE', 'PUBLIC_ORIGIN', 'HYDRA_PUBLIC_URL', 'HYDRA_ADMIN_URL', 'WEBSITE_INTERNAL_URL', 'OUTLINE_INTERNAL_URL',
  'OUTLINE_REDIS_URL', 'OUTLINE_OIDC_CLIENT_SECRET', 'OUTLINE_STORAGE_DIRECTORY', 'POSTGRES_PASSWORD',
  'POSTGRES_USER', 'POSTGRES_VOLUME_NAME', 'POSTGRES_VOLUME_EXTERNAL', 'REDIS_VOLUME_NAME', 'HYDRA_BINARY', 'SERVER_HOST', 'SERVER_PORT', 'OUTLINE_HOST', 'OUTLINE_PORT',
  'HYDRA_LISTEN_HOST', 'HYDRA_LISTEN_PUBLIC_PORT', 'HYDRA_LISTEN_ADMIN_PORT', 'IDENTITY_OUTBOX_TARGETS_JSON',
  'INTEGRATION_NODE_BIN', 'INTEGRATION_COREPACK_JS', 'PM2_BINARY', 'RUNTIME_LOG_MAX_BYTES', 'RUNTIME_LOG_RETAIN',
  'NGINX_BINARY', 'NGINX_SITE_CERT', 'NGINX_SITE_KEY', 'NGINX_ISSUER_CERT', 'NGINX_ISSUER_KEY',
  'HYDRA_INTERNAL_PUBLIC_URL'])
export const pick = (values, keys) => Object.fromEntries(keys.filter(key => values[key] !== undefined).map(key => [key, values[key]]))
export function operatingEnvironment(inherited = process.env) {
  return pick(inherited, ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'ComSpec', 'PATHEXT',
    'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'LC_ALL', 'TERM',
    'COREPACK_HOME', 'COREPACK_ENABLE_DOWNLOAD_PROMPT', 'PNPM_HOME', 'PM2_HOME', 'CI', 'NO_COLOR', 'FORCE_COLOR'])
}
export function withNodePath(environment, node) {
  const path = Object.entries(environment).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? ''
  return { ...Object.fromEntries(Object.entries(environment).filter(([key]) => key.toUpperCase() !== 'PATH')), PATH: `${dirname(node)}${delimiter}${path}` }
}
export function environmentFile(path) {
  try { return existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {} }
  catch { throw new RuntimeError('ENV_INVALID', { keys: ['.env.local'] }) }
}
function required(value, key) {
  if (typeof value !== 'string' || !value.length || /[\u0000\r\n]/.test(value)) throw new RuntimeError('CONFIG_REQUIRED', { keys: [key] })
  return value
}
function port(value, key) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1024 || Number(value) > 65535) throw new RuntimeError('PORT_INVALID', { keys: [key] })
  return Number(value)
}
export function runtimeUrl(value, key, { local = false, https = false } = {}) {
  let url
  try { url = new URL(value) } catch { throw new RuntimeError('URL_INVALID', { keys: [key] }) }
  if (!/^https?:\/\/[^/\s\\]+\/?$/.test(value ?? '') || url.username || url.password || url.search || url.hash ||
      (https && url.protocol !== 'https:') || (local && (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port)))
    throw new RuntimeError('URL_INVALID', { keys: [key] })
  return url.href
}

/** One source per setting. URL components are encoded, never interpolated as credentials. */
export function databaseUrl(values, prefix, database, defaultPort = 5432) {
  const key = field => `${prefix}_${field}`
  if (required(values[key('NAME')], key('NAME')) !== database) throw new RuntimeError('DATABASE_IDENTITY_CONFLICT', { keys: [key('NAME')] })
  const host = required(values[key('HOST')], key('HOST'))
  if (!/^(?:[A-Za-z0-9.-]+|\[[0-9a-fA-F:]+\])$/.test(host)) throw new RuntimeError('DATABASE_HOST_INVALID', { keys: [key('HOST')] })
  const url = new URL(`postgresql://${host}:${port(values[key('PORT')] ?? defaultPort, key('PORT'))}/${database}`)
  url.username = encodeURIComponent(required(values[key('USER')], key('USER')))
  url.password = encodeURIComponent(required(values[key('PASSWORD')], key('PASSWORD')))
  for (const [field, parameter] of [['SSLMODE', 'sslmode'], ['SSLROOTCERT', 'sslrootcert'], ['CONNECT_TIMEOUT', 'connect_timeout'], ['OPTIONS', 'options']]) {
    if (values[key(field)] !== undefined) url.searchParams.set(parameter, required(values[key(field)], key(field)))
  }
  if (values[key('SSLMODE')] !== undefined && !['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(values[key('SSLMODE')]))
    throw new RuntimeError('DATABASE_TLS_INVALID', { keys: [key('SSLMODE')] })
  return url.href
}

/** Pure root-only read; no receipt, database, Docker or implicit migration. */
export function readRuntimeConfiguration({ workspace = root, inherited = process.env, profile } = {}) {
  const file = environmentFile(join(workspace, '.env.local'))
  const legacy = ['DATABASE_URL', 'OUTLINE_DATABASE_URL', 'HYDRA_DATABASE_URL', 'OUTLINE_PASSWORD', 'HYDRA_PASSWORD', 'RUNTIME_CONFIG_VERSION']
    .filter(key => file[key] !== undefined || inherited[key] !== undefined)
  if (legacy.length) throw new RuntimeError('EXPLICIT_CONFIG_CONVERSION_REQUIRED', { keys: legacy,
    reason: '检测到旧 URL 配置，普通入口只接受数据库组件字段', next: '核对原连接目标和凭据后显式执行 pnpm infra convert；转换会备份原配置，不迁移数据或轮换秘密' })
  const values = { ...pick(file, supportedKeys), ...pick(inherited, supportedKeys) }
  if (!['local', 'deployment'].includes(values.RUNTIME_PROFILE) || profile && values.RUNTIME_PROFILE !== profile)
    throw new RuntimeError('PROFILE_INVALID', { keys: ['RUNTIME_PROFILE'] })
  const local = values.RUNTIME_PROFILE === 'local'
  for (const key of ['SERVER_HOST', 'OUTLINE_HOST', 'HYDRA_LISTEN_HOST']) if (values[key] !== undefined && values[key] !== '127.0.0.1')
    throw new RuntimeError('PRIVATE_LISTENER_REQUIRED', { keys: [key] })
  const ports = Object.fromEntries(Object.entries(portKeys).map(([name, key]) => [name, port(values[key] ?? defaults[name], key)]))
  if (local && new Set(Object.values(ports)).size !== Object.keys(ports).length) throw new RuntimeError('PORT_CONFLICT', { keys: Object.values(portKeys) })
  const publicOrigin = new URL(runtimeUrl(values.PUBLIC_ORIGIN ?? (local ? `http://127.0.0.1:${ports.public}` : undefined), 'PUBLIC_ORIGIN', { local, https: !local })).origin
  const issuer = runtimeUrl(values.HYDRA_PUBLIC_URL ?? (local ? `http://127.0.0.1:${ports.hydraPublic}/` : undefined), 'HYDRA_PUBLIC_URL', { local, https: !local })
  if (local && (publicOrigin !== `http://127.0.0.1:${ports.public}` || issuer !== `http://127.0.0.1:${ports.hydraPublic}/`))
    throw new RuntimeError('LAYOUT_CONFLICT', { keys: ['PUBLIC_ORIGIN', 'HYDRA_PUBLIC_URL'] })
  for (const key of cryptoKeys) {
    const value = required(values[key], key)
    if (key === 'OUTLINE_UTILS_SECRET') continue
    if (!/^[0-9a-f]{64}$/i.test(value)) throw new RuntimeError('CRYPTO_KEY_INVALID', { keys: [key] })
  }
  for (const key of ['STORAGE_UPLOAD_HMAC_KEY', 'SERVER_NOTIFICATION_TOKEN_KEY']) if (values[key] !== undefined && !/^[0-9a-f]{64}$/i.test(values[key]))
    throw new RuntimeError('CRYPTO_KEY_INVALID', { keys: [key] })
  required(values.OUTLINE_OIDC_CLIENT_SECRET, 'OUTLINE_OIDC_CLIENT_SECRET')
  const databases = Object.fromEntries(databasePrefixes.map((prefix, index) => [prefix, databaseUrl(values, prefix, ['exre', 'outline', 'hydra'][index], local ? ports.postgres : 5432)]))
  const storage = values.OUTLINE_STORAGE_DIRECTORY ?? (local ? join(workspace, '.local/docs-integration/local-dev/data/outline') : undefined)
  if (!storage || !isAbsolute(storage)) throw new RuntimeError('STORAGE_PATH_INVALID', { keys: ['OUTLINE_STORAGE_DIRECTORY'] })
  const redis = values.OUTLINE_REDIS_URL ?? (local ? `redis://127.0.0.1:${ports.redis}` : undefined)
  try { if (!['redis:', 'rediss:'].includes(new URL(redis).protocol)) throw new Error() }
  catch { throw new RuntimeError('REDIS_URL_INVALID', { keys: ['OUTLINE_REDIS_URL'] }) }
  const internal = { hydra: runtimeUrl(values.HYDRA_ADMIN_URL ?? (local ? `http://127.0.0.1:${ports.hydraAdmin}/` : undefined), 'HYDRA_ADMIN_URL', { local }),
    website: runtimeUrl(values.WEBSITE_INTERNAL_URL ?? (local ? `http://127.0.0.1:${ports.api}/` : undefined), 'WEBSITE_INTERNAL_URL', { local }),
    outline: runtimeUrl(values.OUTLINE_INTERNAL_URL ?? (local ? `http://127.0.0.1:${ports.outline}/` : undefined), 'OUTLINE_INTERNAL_URL', { local }) }
  if (local && (internal.hydra !== `http://127.0.0.1:${ports.hydraAdmin}/` || internal.website !== `http://127.0.0.1:${ports.api}/` || internal.outline !== `http://127.0.0.1:${ports.outline}/` ||
      values.SERVER_PORT !== undefined && Number(values.SERVER_PORT) !== ports.api || values.OUTLINE_PORT !== undefined && Number(values.OUTLINE_PORT) !== ports.outline ||
      values.HYDRA_LISTEN_PUBLIC_PORT !== undefined && Number(values.HYDRA_LISTEN_PUBLIC_PORT) !== ports.hydraPublic || values.HYDRA_LISTEN_ADMIN_PORT !== undefined && Number(values.HYDRA_LISTEN_ADMIN_PORT) !== ports.hydraAdmin))
    throw new RuntimeError('LOCAL_LISTENER_CONFLICT', { keys: ['HYDRA_ADMIN_URL', 'WEBSITE_INTERNAL_URL', 'OUTLINE_INTERNAL_URL', 'SERVER_PORT', 'OUTLINE_PORT'] })
  if (!local) {
    for (const [name, key, url] of [['api', 'SERVER_PORT', internal.website], ['outline', 'OUTLINE_PORT', internal.outline],
      ['hydraAdmin', 'HYDRA_LISTEN_ADMIN_PORT', internal.hydra], ['hydraPublic', 'HYDRA_LISTEN_PUBLIC_PORT', values.HYDRA_INTERNAL_PUBLIC_URL ?? `http://127.0.0.1:${ports.hydraPublic}/`]]) {
      const target = new URL(runtimeUrl(url, key))
      ports[name] = port(target.port || (target.protocol === 'https:' ? 443 : 80), key)
      if (values[key] !== undefined && port(values[key], key) !== ports[name]) throw new RuntimeError('LISTENER_TARGET_CONFLICT', { keys: [key] })
    }
  }
  const target = new URL(databases.DATABASE)
  const config = { version: 1, mode: 'local', project: 'exwebsite-runtime', ports, publicOrigin, issuer,
    callback: `${publicOrigin}/docs/auth/oidc.callback`, clientId: local ? 'ex-outline-local' : 'ex-outline', storage,
    websiteTarget: { host: target.hostname, port: Number(target.port), database: 'exre', user: decodeURIComponent(target.username), verifiedDatabase: 'exre' } }
  const state = { workspace, directory: join(workspace, '.local/runtime'), profile: values.RUNTIME_PROFILE, values,
    databases, internal, redis, config, secrets: pick(values, [...cryptoKeys, 'OUTLINE_OIDC_CLIENT_SECRET']),
    website: { ...pick(values, websiteKeys), DATABASE_URL: databases.DATABASE, AUTH_CODE_HMAC_KEY: values.AUTH_CODE_HMAC_KEY },
    inherited: operatingEnvironment(inherited), overrides: pick(inherited, supportedKeys), fingerprint: digest({ profile: values.RUNTIME_PROFILE, config }) }
  state.environments = environmentsFor(state)
  return state
}

export function environmentsFor(state, service) {
  const { config: c, values: v, inherited: os } = state, p = c.ports, local = state.profile === 'local'
  const common = { RUNTIME_ENV_INJECTED: 'true', WEBSITE_INTEGRATION_ENABLED: 'true', WEBSITE_INTEGRATION_MODE: state.profile,
    HYDRA_PUBLIC_URL: c.issuer, HYDRA_ADMIN_URL: state.internal.hydra, WEBSITE_INTERNAL_URL: state.internal.website,
    OUTLINE_INTERNAL_URL: state.internal.outline, OUTLINE_OIDC_CLIENT_ID: c.clientId, OUTLINE_OIDC_REDIRECT_URI: c.callback }
  const identity = pick(v, ['OUTLINE_INTEGRATION_KEY', 'IDENTITY_BOOTSTRAP_KEY', 'IDENTITY_DELIVERY_KEY', 'IDENTITY_FLOW_KEY', 'OUTLINE_OIDC_CLIENT_SECRET'])
  const maps = {
    server: { ...os, ...state.website, ...common, ...identity, ...pick(v, ['IDENTITY_OUTBOX_TARGETS_JSON']), NODE_ENV: local ? 'development' : 'production',
      ...(!local ? { IDENTITY_DEPLOYMENT_RECEIPT_FILE: join(state.workspace, '.local/runtime-deployment/identity.json') } : {}),
      SERVER_HOST: v.SERVER_HOST ?? '127.0.0.1', SERVER_PORT: String(port(v.SERVER_PORT ?? p.api, 'SERVER_PORT')), SERVER_PUBLIC_WEB_BASE_URL: c.publicOrigin,
      SERVER_PUBLIC_AVATAR_BASE_URL: v.SERVER_PUBLIC_AVATAR_BASE_URL ?? `${c.publicOrigin}/api/avatars` },
    web: { ...os, VITE_API_BASE_URL: '/api', WEBSITE_DEV_ENTRY_PORT: String(p.public), INTEGRATION_WEB_PORT: String(p.web),
      INTEGRATION_SERVER_PORT: String(p.api), OUTLINE_DEV_HTTP_PORT: String(p.outline), INTEGRATION_OUTLINE_VITE_PORT: String(p.outlineVite),
      SERVER_PUBLIC_WEB_BASE_URL: c.publicOrigin, WEBSITE_INTEGRATION_ENABLED: 'true', WEBSITE_INTEGRATION_MODE: 'local' },
    outline: { ...os, ...common, ...identity, NODE_ENV: local ? 'development' : 'production', URL: `${c.publicOrigin}/docs`, WEBSITE_URL: `${c.publicOrigin}/`,
      HOST: v.OUTLINE_HOST ?? '127.0.0.1', PORT: String(port(v.OUTLINE_PORT ?? p.outline, 'OUTLINE_PORT')), INTEGRATION_OUTLINE_VITE_PORT: String(p.outlineVite), WEB_CONCURRENCY: '1',
      FORCE_HTTPS: local ? 'false' : 'true', SECRET_KEY: v.OUTLINE_SECRET_KEY, UTILS_SECRET: v.OUTLINE_UTILS_SECRET,
      DATABASE_URL: state.databases.OUTLINE_DATABASE, DATABASE_CONNECTION_POOL_URL: '', DATABASE_SCHEMA: 'public',
      PGSSLMODE: v.OUTLINE_DATABASE_SSLMODE ?? (local ? 'disable' : ''), REDIS_URL: state.redis, REDIS_COLLABORATION_URL: state.redis,
      FILE_STORAGE: 'local', FILE_STORAGE_LOCAL_ROOT_DIR: c.storage, SSL_CERT_FILE: '', SSL_KEY_FILE: '' },
    hydra: { ...os, DSN: state.databases.HYDRA_DATABASE, SECRETS_SYSTEM: v.HYDRA_SYSTEM_SECRET, URLS_SELF_ISSUER: c.issuer,
      URLS_LOGIN: `${c.publicOrigin}/identity/login`, URLS_CONSENT: `${c.publicOrigin}/identity/consent`, URLS_LOGOUT: `${c.publicOrigin}/identity/logout`,
      SERVE_PUBLIC_HOST: v.HYDRA_LISTEN_HOST ?? '127.0.0.1', SERVE_ADMIN_HOST: v.HYDRA_LISTEN_HOST ?? '127.0.0.1',
      SERVE_PUBLIC_PORT: String(port(v.HYDRA_LISTEN_PUBLIC_PORT ?? p.hydraPublic, 'HYDRA_LISTEN_PUBLIC_PORT')),
      SERVE_ADMIN_PORT: String(port(v.HYDRA_LISTEN_ADMIN_PORT ?? p.hydraAdmin, 'HYDRA_LISTEN_ADMIN_PORT')),
      TTL_AUTH_CODE: '60s', TTL_ACCESS_TOKEN: '60s', TTL_ID_TOKEN: '60s', LOG_FORMAT: 'json', LOG_LEAK_SENSITIVE_VALUES: 'false' },
  }
  return service ? maps[service] : maps
}
