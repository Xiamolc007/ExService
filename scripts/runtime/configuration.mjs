import { existsSync, readFileSync } from 'node:fs'
import { join, isAbsolute, dirname, delimiter } from 'node:path'
import { parseEnv } from 'node:util'
import { root } from '../docs-integration/configure.mjs'
import { defaults, secretNames, digest, websiteTarget, LocalError, readJson } from '../docs-integration/local-config.mjs'

export const portKeys = Object.freeze({ public: 'LOCAL_PUBLIC_PORT', web: 'LOCAL_WEB_PORT', api: 'LOCAL_API_PORT',
  outline: 'LOCAL_OUTLINE_PORT', outlineVite: 'LOCAL_OUTLINE_VITE_PORT', postgres: 'LOCAL_POSTGRES_PORT',
  redis: 'LOCAL_REDIS_PORT', hydraPublic: 'LOCAL_HYDRA_PUBLIC_PORT', hydraAdmin: 'LOCAL_HYDRA_ADMIN_PORT' })
export const websiteKeys = Object.freeze(['DATABASE_URL', 'AUTH_CODE_HMAC_KEY', 'SERVER_AVATAR_DIRECTORY',
  'SERVER_CORS_ALLOWED_ORIGINS', 'SERVER_PUBLIC_AVATAR_BASE_URL', 'STORAGE_DEFAULT_ADAPTER', 'STORAGE_MAX_BYTES',
  'STORAGE_PUBLIC_API_BASE_URL', 'STORAGE_UPLOAD_HMAC_KEY', 'TENCENT_COS_BUCKET', 'TENCENT_COS_REGION',
  'TENCENT_COS_SECRET_ID', 'TENCENT_COS_SECRET_KEY'])
const toolKeys = ['INTEGRATION_NODE_BIN', 'INTEGRATION_COREPACK_JS', 'EXUI_SOURCE_DIR']
const identityKeys = ['OUTLINE_INTEGRATION_KEY', 'IDENTITY_BOOTSTRAP_KEY', 'IDENTITY_DELIVERY_KEY', 'IDENTITY_FLOW_KEY', 'OUTLINE_OIDC_CLIENT_SECRET']
const supported = [...websiteKeys, ...secretNames, ...Object.values(portKeys), ...toolKeys, 'RUNTIME_CONFIG_VERSION',
  'RUNTIME_PROFILE', 'PUBLIC_ORIGIN', 'HYDRA_PUBLIC_URL', 'HYDRA_ADMIN_URL', 'WEBSITE_INTERNAL_URL',
  'OUTLINE_INTERNAL_URL', 'OUTLINE_DATABASE_URL', 'HYDRA_DATABASE_URL', 'OUTLINE_REDIS_URL',
  'OUTLINE_STORAGE_DIRECTORY', 'IDENTITY_OUTBOX_TARGETS_JSON', 'IDENTITY_DEPLOYMENT_RECEIPT_FILE', 'VITE_API_BASE_URL']
const osKeys = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'ComSpec', 'PATHEXT',
  'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'LC_ALL', 'TERM']
export const pick = (values, keys) => Object.fromEntries(keys.filter(key => values[key] !== undefined).map(key => [key, values[key]]))
export function operatingEnvironment(inherited = process.env) { return pick(inherited, osKeys) }
export function withNodePath(environment, node) {
  const original = Object.entries(environment).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? ''
  return { ...Object.fromEntries(Object.entries(environment).filter(([key]) => key.toUpperCase() !== 'PATH')), PATH: `${dirname(node)}${delimiter}${original}` }
}
export function environmentFile(path) {
  try { return existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {} }
  catch { throw new LocalError('RUNTIME_ENV_INVALID', 'check root .env.local key syntax') }
}
export function runtimeUrl(value, key, { local = false, https = false } = {}) {
  let url
  try { url = new URL(value) } catch { throw new LocalError(`RUNTIME_INVALID_${key}`, 'check root .env.local') }
  if (!/^https?:\/\/[^/\s\\]+\/?$/.test(value ?? '') || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (https && url.protocol !== 'https:') || (local && (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port)))
    throw new LocalError(`RUNTIME_INVALID_${key}`, 'check root .env.local')
  return url.href
}
function database(value, name, key) {
  let url
  try { url = new URL(value) } catch { throw new LocalError(`RUNTIME_INVALID_${key}`) }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname !== `/${name}` || !url.hostname || !url.username || url.hash)
    throw new LocalError(`RUNTIME_INVALID_${key}`)
  return value
}
/** Pure configuration read: no database, Docker or file mutations. */
export function readRuntimeConfiguration({ workspace = root, inherited = process.env, profile, allowMissingSecrets = false } = {}) {
  const directory = join(workspace, '.local/docs-integration/local-dev')
  const values = { ...pick(environmentFile(join(workspace, '.env.local')), supported), ...pick(inherited, supported) }
  if (values.RUNTIME_CONFIG_VERSION !== '2' || !['local', 'deployment'].includes(values.RUNTIME_PROFILE) ||
      (profile && values.RUNTIME_PROFILE !== profile)) throw new LocalError('RUNTIME_PROFILE_INVALID', 'pnpm infra configure')
  const local = values.RUNTIME_PROFILE === 'local'
  const ports = Object.fromEntries(Object.entries(portKeys).map(([name, key]) => [name, values[key] === undefined ? defaults[name] : Number(values[key])]))
  if (local && (Object.values(ports).some(value => !Number.isSafeInteger(value) || value < 1024 || value > 65535) ||
      new Set(Object.values(ports)).size !== 9)) throw new LocalError('RUNTIME_PORTS_INVALID')
  const publicOrigin = new URL(runtimeUrl(values.PUBLIC_ORIGIN ?? (local ? `http://127.0.0.1:${ports.public}` : undefined), 'PUBLIC_ORIGIN', { local, https: !local })).origin
  const issuer = runtimeUrl(values.HYDRA_PUBLIC_URL ?? (local ? `http://127.0.0.1:${ports.hydraPublic}/` : undefined), 'HYDRA_PUBLIC_URL', { local, https: !local })
  if (!local && (values.PUBLIC_ORIGIN !== publicOrigin || values.HYDRA_PUBLIC_URL !== issuer)) throw new LocalError('RUNTIME_DEPLOYMENT_URL_CANONICAL_REQUIRED')
  if (local && (publicOrigin !== `http://127.0.0.1:${ports.public}` || issuer !== `http://127.0.0.1:${ports.hydraPublic}/`))
    throw new LocalError('RUNTIME_LAYOUT_CONFLICT')
  const secrets = pick(values, secretNames)
  for (const name of secretNames) if (!(allowMissingSecrets && values[name] === undefined) && !/^[0-9a-f]{64}$/.test(values[name] ?? ''))
    throw new LocalError(`RUNTIME_INVALID_${name}`)
  const website = pick(values, websiteKeys), target = websiteTarget(website)
  if (!/^[0-9a-f]{64}$/i.test(website.AUTH_CODE_HMAC_KEY ?? '')) throw new LocalError('RUNTIME_INVALID_AUTH_CODE_HMAC_KEY')
  const storage = values.OUTLINE_STORAGE_DIRECTORY ?? (local ? join(directory, 'data/outline') : undefined)
  if (!storage || !isAbsolute(storage)) throw new LocalError('RUNTIME_INVALID_OUTLINE_STORAGE_DIRECTORY')
  const config = { version: 1, mode: 'local', project: 'exwebsite-local-dev', ports, publicOrigin, issuer,
    callback: `${publicOrigin}/docs/auth/oidc.callback`, clientId: local ? 'ex-outline-local' : 'ex-outline', storage, websiteTarget: target }
  const internal = local ? { hydra: `http://127.0.0.1:${ports.hydraAdmin}/`, website: `http://127.0.0.1:${ports.api}/`, outline: `http://127.0.0.1:${ports.outline}/` }
    : { hydra: runtimeUrl(values.HYDRA_ADMIN_URL, 'HYDRA_ADMIN_URL'), website: runtimeUrl(values.WEBSITE_INTERNAL_URL, 'WEBSITE_INTERNAL_URL'), outline: runtimeUrl(values.OUTLINE_INTERNAL_URL, 'OUTLINE_INTERNAL_URL') }
  const derived = { SERVER_PUBLIC_WEB_BASE_URL: publicOrigin, HYDRA_ADMIN_URL: internal.hydra, WEBSITE_INTERNAL_URL: internal.website,
    OUTLINE_INTERNAL_URL: internal.outline, OUTLINE_OIDC_CLIENT_ID: config.clientId, OUTLINE_OIDC_REDIRECT_URI: config.callback,
    WEBSITE_INTEGRATION_MODE: values.RUNTIME_PROFILE, WEBSITE_DEV_ENTRY_PORT: String(ports.public), INTEGRATION_WEB_PORT: String(ports.web),
    INTEGRATION_SERVER_PORT: String(ports.api), OUTLINE_DEV_HTTP_PORT: String(ports.outline), INTEGRATION_OUTLINE_VITE_PORT: String(ports.outlineVite) }
  for (const [key, value] of Object.entries(derived)) if (inherited[key] !== undefined && inherited[key] !== value || values[key] !== undefined && values[key] !== value)
    throw new LocalError(`RUNTIME_ASSERTION_CONFLICT_${key}`)
  if (!local) {
    database(values.OUTLINE_DATABASE_URL, 'outline', 'OUTLINE_DATABASE_URL'); database(values.HYDRA_DATABASE_URL, 'hydra', 'HYDRA_DATABASE_URL')
    try { if (!['redis:', 'rediss:'].includes(new URL(values.OUTLINE_REDIS_URL).protocol)) throw new Error() }
    catch { throw new LocalError('RUNTIME_INVALID_OUTLINE_REDIS_URL') }
  }
  const state = { workspace, directory, profile: values.RUNTIME_PROFILE, values, inherited: operatingEnvironment(inherited), config, secrets, website,
    fingerprint: digest({ config, secrets }), configurationFingerprint: digest({ ...values, config }) }
  if (values.IDENTITY_OUTBOX_TARGETS_JSON !== undefined) {
    let targets
    try { targets = JSON.parse(values.IDENTITY_OUTBOX_TARGETS_JSON) } catch { throw new LocalError('RUNTIME_OUTBOX_TARGETS_INVALID') }
    if (!targets || typeof targets !== 'object' || Array.isArray(targets)) throw new LocalError('RUNTIME_OUTBOX_TARGETS_INVALID')
    for (const [id, target] of Object.entries(targets)) {
      if (!['ex-outline-local', 'ex-outline', 'ex-oidc-probe'].includes(id) || !target || typeof target !== 'object' || Array.isArray(target) ||
          Object.keys(target).some(key => !['hydraAdminUrl', 'outlineInternalUrl', 'deliveryKey'].includes(key))) throw new LocalError('RUNTIME_OUTBOX_TARGETS_INVALID')
      const cleanupUrl = value => runtimeUrl(value, 'IDENTITY_OUTBOX_TARGETS_JSON', { local: id === 'ex-outline-local' &&
        !(state.profile === 'deployment' && /^http:\/\/host\.docker\.internal:[1-9]\d{0,4}\/?$/.test(value ?? '')) })
      const normalized = { hydraAdminUrl: cleanupUrl(target.hydraAdminUrl) }
      if (id === 'ex-oidc-probe') {
        if (target.deliveryKey !== undefined || target.outlineInternalUrl !== undefined) throw new LocalError('RUNTIME_OUTBOX_TARGETS_INVALID')
      } else {
        normalized.outlineInternalUrl = cleanupUrl(target.outlineInternalUrl)
        if (!/^[0-9a-f]{64}$/i.test(target.deliveryKey ?? '')) throw new LocalError('RUNTIME_OUTBOX_TARGETS_INVALID')
        normalized.deliveryKey = target.deliveryKey
      }
      if (id === config.clientId && digest(normalized) !== digest({ hydraAdminUrl: internal.hydra, outlineInternalUrl: internal.outline, deliveryKey: secrets.IDENTITY_DELIVERY_KEY }))
        throw new LocalError('RUNTIME_OUTBOX_CURRENT_TARGET_CONFLICT')
    }
  }
  state.environments = environmentsFor(state)
  return state
}
/** Explicit service maps prevent backend credentials from reaching Vite. */
export function environmentsFor(state, service) {
  const { config: c, secrets: s, website: w, values: v, inherited: os } = state, p = c.ports, local = state.profile === 'local'
  const common = { WEBSITE_INTEGRATION_ENABLED: 'true', WEBSITE_INTEGRATION_MODE: state.profile, RUNTIME_ENV_INJECTED: 'true',
    HYDRA_PUBLIC_URL: c.issuer, HYDRA_ADMIN_URL: local ? `http://127.0.0.1:${p.hydraAdmin}/` : v.HYDRA_ADMIN_URL,
    WEBSITE_INTERNAL_URL: local ? `http://127.0.0.1:${p.api}/` : v.WEBSITE_INTERNAL_URL,
    OUTLINE_INTERNAL_URL: local ? `http://127.0.0.1:${p.outline}/` : v.OUTLINE_INTERNAL_URL,
    OUTLINE_OIDC_CLIENT_ID: c.clientId, OUTLINE_OIDC_REDIRECT_URI: c.callback }
  const maps = {
    server: { ...os, ...w, ...common, ...pick(s, identityKeys), ...(v.IDENTITY_OUTBOX_TARGETS_JSON !== undefined ? { IDENTITY_OUTBOX_TARGETS_JSON: v.IDENTITY_OUTBOX_TARGETS_JSON } : {}),
      ...(!local ? { IDENTITY_DEPLOYMENT_RECEIPT_FILE: v.IDENTITY_DEPLOYMENT_RECEIPT_FILE ?? join(state.workspace, '.local/runtime-deployment/identity.json') } : {}),
      SERVER_HOST: local ? '127.0.0.1' : '0.0.0.0', SERVER_PORT: local ? String(p.api) : '8080', SERVER_PUBLIC_WEB_BASE_URL: c.publicOrigin,
      SERVER_PUBLIC_AVATAR_BASE_URL: w.SERVER_PUBLIC_AVATAR_BASE_URL ?? `${c.publicOrigin}/api/avatars` },
    web: { ...os, VITE_API_BASE_URL: v.VITE_API_BASE_URL ?? '/api', WEBSITE_DEV_ENTRY_PORT: String(p.public), INTEGRATION_WEB_PORT: String(p.web),
      INTEGRATION_SERVER_PORT: String(p.api), OUTLINE_DEV_HTTP_PORT: String(p.outline), INTEGRATION_OUTLINE_VITE_PORT: String(p.outlineVite), SERVER_PUBLIC_WEB_BASE_URL: c.publicOrigin,
      WEBSITE_INTEGRATION_ENABLED: 'true', WEBSITE_INTEGRATION_MODE: 'local' },
    outline: { ...os, ...common, ...pick(s, identityKeys), NODE_ENV: local ? 'development' : 'production', URL: `${c.publicOrigin}/docs`, WEBSITE_URL: `${c.publicOrigin}/`,
      PORT: local ? String(p.outline) : '3000', INTEGRATION_OUTLINE_VITE_PORT: String(p.outlineVite), FORCE_HTTPS: local ? 'false' : 'true',
      SECRET_KEY: s.OUTLINE_SECRET_KEY, UTILS_SECRET: s.OUTLINE_UTILS_SECRET,
      DATABASE_URL: local ? `postgres://outline:${s.OUTLINE_PASSWORD}@127.0.0.1:${p.postgres}/outline` : v.OUTLINE_DATABASE_URL,
      DATABASE_CONNECTION_POOL_URL: '', DATABASE_SCHEMA: 'public', PGSSLMODE: local ? 'disable' : '',
      REDIS_URL: local ? `redis://127.0.0.1:${p.redis}` : v.OUTLINE_REDIS_URL,
      REDIS_COLLABORATION_URL: local ? `redis://127.0.0.1:${p.redis}` : v.OUTLINE_REDIS_URL,
      FILE_STORAGE: 'local', FILE_STORAGE_LOCAL_ROOT_DIR: c.storage, SSL_CERT_FILE: '', SSL_KEY_FILE: '' },
    hydra: { ...os, DSN: local ? `postgres://hydra:${s.HYDRA_PASSWORD}@127.0.0.1:${p.postgres}/hydra?sslmode=disable` : v.HYDRA_DATABASE_URL,
      SECRETS_SYSTEM: s.HYDRA_SYSTEM_SECRET, URLS_SELF_ISSUER: c.issuer, URLS_LOGIN: `${c.publicOrigin}/identity/login`,
      URLS_CONSENT: `${c.publicOrigin}/identity/consent`, URLS_LOGOUT: `${c.publicOrigin}/identity/logout` },
    compose: { ...os, ...s, LOCAL_POSTGRES_PORT: String(p.postgres), LOCAL_REDIS_PORT: String(p.redis), LOCAL_HYDRA_PUBLIC_PORT: String(p.hydraPublic),
      LOCAL_HYDRA_ADMIN_PORT: String(p.hydraAdmin), LOCAL_PUBLIC_ORIGIN: c.publicOrigin, LOCAL_ISSUER: c.issuer, LOCAL_CONFIG_FINGERPRINT: state.fingerprint },
  }
  return service ? maps[service] : maps
}
export function validateReceipt(state, receipt = readJson(join(state.directory, 'config.json'), 'RUNTIME_NOT_CONFIGURED')) {
  const journal = join(state.directory, 'upgrade.json')
  if (existsSync(journal) && readJson(journal).state !== 'committed') throw new LocalError('RUNTIME_UPGRADE_INCOMPLETE', 'pnpm infra configure --import-existing')
  if (receipt.version !== 2 || receipt.profile !== state.profile || receipt.configurationFingerprint !== state.configurationFingerprint ||
      receipt.resourceFingerprint !== state.fingerprint || digest(receipt.resourceProjection) !== digest(state.config))
    throw new LocalError('RUNTIME_RECEIPT_CONFLICT', 'pnpm infra configure; preserve existing volumes and secrets')
  return receipt
}
