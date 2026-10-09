import { createHash, randomBytes } from 'node:crypto'

/** Provisions a fixed confidential OIDC client without widening existing grants. */
export async function ensureHydraClient(options) { return checkHydraClient(options, true) }
/** Runtime verification can never provision a missing client. */
export async function verifyHydraClient(options) { return checkHydraClient(options, false) }
async function checkHydraClient({ adminUrl, publicUrl = 'http://identity.exwebsite.test:8090/', clientSecret,
  clientId = 'ex-outline', mode = 'dev', publicOrigin = 'http://exwebsite.test:8090', callback, tokenUrl }, create) {
  if (!['local', 'dev', 'full', 'deployment'].includes(mode)) throw new Error('Invalid Hydra bootstrap configuration')
  const origin = new URL(publicOrigin), issuer = new URL(publicUrl)
  if (tokenUrl !== undefined && (mode !== 'full' || tokenUrl !== 'http://hydra:4444/')) throw new Error('Invalid Hydra bootstrap configuration')
  if (origin.href !== `${publicOrigin}/` || origin.username || origin.password || issuer.pathname !== '/' || issuer.search || issuer.hash || issuer.username || issuer.password ||
      (mode === 'local' ? (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port ||
        issuer.protocol !== 'http:' || issuer.hostname !== '127.0.0.1' || !issuer.port || clientId !== 'ex-outline-local') :
        mode === 'deployment' ? (origin.protocol !== 'https:' || issuer.protocol !== 'https:' || clientId !== 'ex-outline' ||
          !/^https:\/\/[^/\s\\]+$/.test(publicOrigin) || !/^https:\/\/[^/\s\\]+\/?$/.test(publicUrl)) :
        (publicOrigin !== 'http://exwebsite.test:8090'))) throw new Error('Invalid Hydra bootstrap configuration')
  const clients = {
    'ex-outline-local': { name: 'Docs Local', callback: `${publicOrigin}/docs/auth/oidc.callback`,
      logout: `${publicOrigin}/identity/signed-out` },
    'ex-outline': { name: 'Docs', callback: `${publicOrigin}/docs/auth/oidc.callback`,
      logout: `${publicOrigin}/identity/signed-out` },
    'ex-oidc-probe': { name: 'OIDC Probe', callback: 'http://127.0.0.1:18765/callback',
      logout: 'http://127.0.0.1:18765/signed-out' },
  }
  const client = Object.hasOwn(clients, clientId) && clients[clientId]
  if (callback !== undefined && callback !== client?.callback) throw new Error('Invalid Hydra bootstrap configuration')
  const base = new URL(adminUrl)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
      base.pathname !== '/' || base.search || base.hash || !clientSecret || !client) throw new Error('Invalid Hydra bootstrap configuration')
  const desired = {
    client_id: clientId, client_name: client.name, client_secret: clientSecret,
    redirect_uris: [client.callback],
    grant_types: ['authorization_code'], response_types: ['code'], scope: 'openid profile email',
    subject_type: 'public', token_endpoint_auth_method: 'client_secret_basic',
    post_logout_redirect_uris: [client.logout],
    authorization_code_grant_access_token_lifespan: '60s', authorization_code_grant_id_token_lifespan: '60s',
    metadata: { integration: 'docs-integration', issuer: issuer.href,
      secretFingerprint: createHash('sha256').update(clientSecret).digest('hex') },
  }
  const request = (path, options = {}) => fetch(new URL(path, base), {
    ...options, signal: AbortSignal.timeout(1000),
  })
  let response = await request(`/admin/clients/${clientId}`)
  if (response.status === 404 && create) {
    response = await request('/admin/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(desired) })
    // A competing bootstrap may have created the same client. Recheck exact state.
    if (response.status === 409) response = await request(`/admin/clients/${clientId}`)
  }
  if (!response.ok) throw new Error(`Hydra client initialization failed (HTTP ${response.status})`)
  const actual = await response.json()
  const lists = ['redirect_uris', 'grant_types', 'response_types', 'post_logout_redirect_uris']
  const scalars = ['client_id', 'subject_type', 'token_endpoint_auth_method']
  const lifespans = ['authorization_code_grant_access_token_lifespan', 'authorization_code_grant_id_token_lifespan']
  const equalList = (left, right) => Array.isArray(left) && Array.isArray(right) &&
    JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
  if (lists.some(key => !equalList(actual[key], desired[key])) || scalars.some(key => actual[key] !== desired[key]) ||
      lifespans.some(key => !['60s', '1m0s'].includes(actual[key])) ||
      !equalList(actual.scope?.split(/\s+/), desired.scope.split(' ')) ||
      Object.entries(desired.metadata).some(([key, value]) => actual.metadata?.[key] !== value) ||
      ['allowed_cors_origins', 'audience'].some(key => actual[key]?.length) ||
      ['frontchannel_logout_uri', 'backchannel_logout_uri', 'jwks_uri'].some(key => actual[key])) {
    throw new Error('Existing Hydra client configuration conflict; explicit operator repair is required')
  }
  // A non-existent random code cannot issue a token, but proves the stored client secret
  // is valid. Hydra does not return stored secrets through its administrative GET API.
  const probe = await fetch(new URL('/oauth2/token', tokenUrl ?? publicUrl), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: randomBytes(32).toString('base64url'),
      redirect_uri: desired.redirect_uris[0], code_verifier: randomBytes(32).toString('base64url') }),
    signal: AbortSignal.timeout(1000),
  })
  const result = await probe.json()
  if (probe.status !== 400 || result.error !== 'invalid_grant') {
    throw new Error('Existing Hydra client secret conflict or protocol service unavailable')
  }
  return { clientId: desired.client_id }
}
