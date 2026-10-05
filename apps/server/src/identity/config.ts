export type IdentityMode = 'local' | 'dev' | 'full'
export type IdentityClientId = 'ex-outline-local' | 'ex-outline' | 'ex-oidc-probe'
export interface IdentityDeliveryTarget {
  readonly hydraAdminUrl: string
  readonly outlineInternalUrl?: string
  readonly deliveryKey?: string
}
export interface IdentityConfig {
  readonly enabled: true
  readonly mode: IdentityMode
  readonly issuer: string
  readonly publicOrigin: string
  readonly callback: string
  readonly clientId: 'ex-outline-local' | 'ex-outline'
  readonly hydraAdminUrl: string
  readonly websiteInternalUrl: string
  readonly keys: Readonly<{ outline: string; bootstrap: string; flow: string; delivery: string }>
  readonly approvedClients: Readonly<Record<string, Readonly<{ name: string; redirectUri: string; scopes: readonly string[] }>>>
  readonly deliveryTargets: Readonly<Partial<Record<IdentityClientId, Readonly<IdentityDeliveryTarget>>>>
}

/** Error names are fixed configuration identifiers, never the supplied values. */
export class IdentityConfigError extends Error {
  readonly code = 'IDENTITY_CONFIG_INVALID'
  constructor(readonly variable: string) {
    super(`IDENTITY_CONFIG_INVALID:${variable}`)
    this.name = 'IdentityConfigError'
  }
}

const allowedIds = ['ex-outline-local', 'ex-outline', 'ex-oidc-probe'] as const
export function isIdentityClientId(value: string): value is IdentityClientId {
  return (allowedIds as readonly string[]).includes(value)
}

function root(value: string | undefined, variable: string, local = false): string {
  if (!value || /[\s\\]/.test(value)) throw new IdentityConfigError(variable)
  let url: URL
  try { url = new URL(value) } catch { throw new IdentityConfigError(variable) }
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' ||
    url.username || url.password || url.search || url.hash ||
    // Do not accept normalized dot paths or alternative spellings of loopback.
    !/^https?:\/\/[^/]+\/?$/.test(value) ||
    (local && (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
      !/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(value)))) {
    throw new IdentityConfigError(variable)
  }
  return url.href
}

function key(value: string | undefined, variable: string): string {
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) throw new IdentityConfigError(variable)
  return value
}

function cleanupRoot(value: string, variable: string, id: IdentityClientId, mode: IdentityMode): string {
  if (id === 'ex-outline-local' && mode === 'full' && /^http:\/\/host\.docker\.internal:[1-9]\d{0,4}\/?$/.test(value)) {
    const parsed = new URL(root(value, variable))
    if (!parsed.port) throw new IdentityConfigError(variable)
    return parsed.href
  }
  return root(value, variable, id === 'ex-outline-local')
}

function extraTargets(raw: string | undefined, mode: IdentityMode): Partial<Record<IdentityClientId, Readonly<IdentityDeliveryTarget>>> {
  if (raw === undefined) return {}
  const variable = 'IDENTITY_OUTBOX_TARGETS_JSON'
  let decoded: unknown
  try { decoded = JSON.parse(raw) } catch { throw new IdentityConfigError(variable) }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new IdentityConfigError(variable)
  const targets: Partial<Record<IdentityClientId, Readonly<IdentityDeliveryTarget>>> = {}
  for (const [id, value] of Object.entries(decoded)) {
    if (!isIdentityClientId(id) || !value || typeof value !== 'object' || Array.isArray(value)) {
      throw new IdentityConfigError(variable)
    }
    const fields = value as Record<string, unknown>
    if (Object.keys(fields).some(name => !['hydraAdminUrl', 'outlineInternalUrl', 'deliveryKey'].includes(name)) ||
      typeof fields.hydraAdminUrl !== 'string') throw new IdentityConfigError(variable)
    const hydraAdminUrl = cleanupRoot(fields.hydraAdminUrl, variable, id, mode)
    if (id === 'ex-oidc-probe') {
      if (fields.outlineInternalUrl !== undefined || fields.deliveryKey !== undefined) throw new IdentityConfigError(variable)
      targets[id] = Object.freeze({ hydraAdminUrl })
    } else {
      if (typeof fields.outlineInternalUrl !== 'string' || typeof fields.deliveryKey !== 'string') {
        throw new IdentityConfigError(variable)
      }
      targets[id] = Object.freeze({ hydraAdminUrl,
        outlineInternalUrl: cleanupRoot(fields.outlineInternalUrl, variable, id, mode),
        deliveryKey: key(fields.deliveryKey, variable) })
    }
  }
  return targets
}

/** Pure immutable configuration; only an enabled legacy caller may omit mode. */
export function parseIdentityConfig(env: NodeJS.ProcessEnv = process.env): IdentityConfig | Readonly<{ enabled: false }> {
  if (env.WEBSITE_INTEGRATION_ENABLED !== undefined && !['true', 'false'].includes(env.WEBSITE_INTEGRATION_ENABLED)) {
    throw new IdentityConfigError('WEBSITE_INTEGRATION_ENABLED')
  }
  if (env.WEBSITE_INTEGRATION_ENABLED !== 'true') return Object.freeze({ enabled: false })
  const mode = env.WEBSITE_INTEGRATION_MODE ?? 'dev'
  if (!['local', 'dev', 'full'].includes(mode)) throw new IdentityConfigError('WEBSITE_INTEGRATION_MODE')
  const local = mode === 'local'
  const publicOrigin = new URL(root(env.SERVER_PUBLIC_WEB_BASE_URL ??
    (local ? 'http://127.0.0.1:8080' : 'http://exwebsite.test:8090'), 'SERVER_PUBLIC_WEB_BASE_URL', local)).origin
  const issuer = root(env.HYDRA_PUBLIC_URL ??
    (local ? 'http://127.0.0.1:14444/' : 'http://identity.exwebsite.test:8090/'), 'HYDRA_PUBLIC_URL', local)
  if (!local && (publicOrigin !== 'http://exwebsite.test:8090' || issuer !== 'http://identity.exwebsite.test:8090/')) {
    throw new IdentityConfigError('WEBSITE_INTEGRATION_MODE')
  }
  const clientId = local ? 'ex-outline-local' : 'ex-outline'
  if (env.OUTLINE_OIDC_CLIENT_ID !== undefined && env.OUTLINE_OIDC_CLIENT_ID !== clientId) {
    throw new IdentityConfigError('OUTLINE_OIDC_CLIENT_ID')
  }
  const callback = `${publicOrigin}/docs/auth/oidc.callback`
  if (env.OUTLINE_OIDC_REDIRECT_URI !== undefined && env.OUTLINE_OIDC_REDIRECT_URI !== callback) {
    throw new IdentityConfigError('OUTLINE_OIDC_REDIRECT_URI')
  }
  const hydraAdminUrl = root(env.HYDRA_ADMIN_URL ?? (local ? 'http://127.0.0.1:14447/' : undefined), 'HYDRA_ADMIN_URL', local)
  const outlineInternalUrl = root(env.OUTLINE_INTERNAL_URL ?? (local ? 'http://127.0.0.1:3102/' : undefined), 'OUTLINE_INTERNAL_URL', local)
  const websiteInternalUrl = root(env.WEBSITE_INTERNAL_URL ??
    (local ? 'http://127.0.0.1:8082/' : mode === 'full' ? 'http://server:8080/' : 'http://127.0.0.1:18080/'), 'WEBSITE_INTERNAL_URL', local)
  if (local && new Set([publicOrigin, new URL(issuer).origin, new URL(hydraAdminUrl).origin,
    new URL(outlineInternalUrl).origin, new URL(websiteInternalUrl).origin]).size !== 5) {
    throw new IdentityConfigError('WEBSITE_INTEGRATION_MODE')
  }
  const keys = Object.freeze({ outline: key(env.OUTLINE_INTEGRATION_KEY, 'OUTLINE_INTEGRATION_KEY'),
    bootstrap: key(env.IDENTITY_BOOTSTRAP_KEY, 'IDENTITY_BOOTSTRAP_KEY'),
    flow: key(env.IDENTITY_FLOW_KEY, 'IDENTITY_FLOW_KEY'), delivery: key(env.IDENTITY_DELIVERY_KEY, 'IDENTITY_DELIVERY_KEY') })
  const targets = extraTargets(env.IDENTITY_OUTBOX_TARGETS_JSON, mode as IdentityMode)
  const current = Object.freeze({ hydraAdminUrl, outlineInternalUrl, deliveryKey: keys.delivery })
  // Explicit old configuration must never replace the current configured destination.
  if (targets[clientId] && JSON.stringify(targets[clientId]) !== JSON.stringify(current)) {
    throw new IdentityConfigError('IDENTITY_OUTBOX_TARGETS_JSON')
  }
  targets[clientId] = current
  if (!local) {
    if (targets['ex-oidc-probe'] && targets['ex-oidc-probe']!.hydraAdminUrl !== hydraAdminUrl) {
      throw new IdentityConfigError('IDENTITY_OUTBOX_TARGETS_JSON')
    }
    targets['ex-oidc-probe'] = Object.freeze({ hydraAdminUrl })
  }
  const scopes = Object.freeze(['openid', 'profile', 'email'])
  const clients: Record<string, Readonly<{ name: string; redirectUri: string; scopes: readonly string[] }>> = {
    [clientId]: Object.freeze({ name: 'Docs', redirectUri: callback, scopes }),
  }
  if (!local) clients['ex-oidc-probe'] = Object.freeze({ name: 'OIDC Probe', redirectUri: 'http://127.0.0.1:18765/callback', scopes })
  return Object.freeze({ enabled: true, mode: mode as IdentityMode, issuer, publicOrigin, callback, clientId,
    hydraAdminUrl, websiteInternalUrl, keys, approvedClients: Object.freeze(clients), deliveryTargets: Object.freeze(targets) })
}
