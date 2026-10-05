import { expect, it } from 'vitest'
import { IdentityConfigError, parseIdentityConfig } from '@server/src/identity/config'

const keys = { OUTLINE_INTEGRATION_KEY: 'a'.repeat(64), IDENTITY_DELIVERY_KEY: 'b'.repeat(64),
  IDENTITY_BOOTSTRAP_KEY: 'c'.repeat(64), IDENTITY_FLOW_KEY: 'd'.repeat(64) }
const local = { WEBSITE_INTEGRATION_ENABLED: 'true', WEBSITE_INTEGRATION_MODE: 'local', ...keys }
const legacy = { WEBSITE_INTEGRATION_ENABLED: 'true', HYDRA_ADMIN_URL: 'http://hydra:4445/',
  OUTLINE_INTERNAL_URL: 'http://outline:3000/', ...keys }

it('disables identity explicitly and parses a deeply immutable fixed local layout', () => {
  expect(parseIdentityConfig({})).toEqual({ enabled: false })
  const config = parseIdentityConfig(local)
  expect(config).toMatchObject({ enabled: true, mode: 'local', issuer: 'http://127.0.0.1:14444/',
    clientId: 'ex-outline-local', publicOrigin: 'http://127.0.0.1:8080',
    callback: 'http://127.0.0.1:8080/docs/auth/oidc.callback', hydraAdminUrl: 'http://127.0.0.1:14447/' })
  if (!config.enabled) throw new Error('expected enabled')
  expect(Object.keys(config.approvedClients)).toEqual(['ex-outline-local'])
  expect(Object.keys(config.deliveryTargets)).toEqual(['ex-outline-local'])
  for (const value of [config, config.keys, config.approvedClients, config.approvedClients['ex-outline-local'],
    config.approvedClients['ex-outline-local']!.scopes, config.deliveryTargets, config.deliveryTargets['ex-outline-local']]) {
    expect(Object.isFrozen(value)).toBe(true)
  }
})

it.each(['dev', 'full', undefined])('preserves the fixed legacy layout for %s mode', mode => {
  const config = parseIdentityConfig({ ...legacy, WEBSITE_INTEGRATION_MODE: mode })
  expect(config).toMatchObject({ enabled: true, mode: mode ?? 'dev', clientId: 'ex-outline',
    issuer: 'http://identity.exwebsite.test:8090/', callback: 'http://exwebsite.test:8090/docs/auth/oidc.callback' })
  if (!config.enabled) throw new Error('expected enabled')
  expect(Object.keys(config.approvedClients)).toEqual(['ex-outline', 'ex-oidc-probe'])
  expect(config.deliveryTargets['ex-oidc-probe']).toEqual({ hydraAdminUrl: 'http://hydra:4445/' })
})

it('derives a callback only from explicitly configured local ports', () => {
  expect(parseIdentityConfig({ ...local, SERVER_PUBLIC_WEB_BASE_URL: 'http://127.0.0.1:18080/',
    HYDRA_PUBLIC_URL: 'http://127.0.0.1:24444/', HYDRA_ADMIN_URL: 'http://127.0.0.1:24447/',
    OUTLINE_INTERNAL_URL: 'http://127.0.0.1:13102/', WEBSITE_INTERNAL_URL: 'http://127.0.0.1:18082/' }))
    .toMatchObject({ publicOrigin: 'http://127.0.0.1:18080', callback: 'http://127.0.0.1:18080/docs/auth/oidc.callback',
      issuer: 'http://127.0.0.1:24444/' })
})

it.each([
  ['WEBSITE_INTEGRATION_ENABLED', 'yes'], ['WEBSITE_INTEGRATION_MODE', 'unknown'],
  ['SERVER_PUBLIC_WEB_BASE_URL', 'http://exwebsite.test:8090'],
  ['SERVER_PUBLIC_WEB_BASE_URL', 'http://127.0.0.1:8080/docs'],
  ['SERVER_PUBLIC_WEB_BASE_URL', 'http://127.0.0.1:8080/a/..'],
  ['HYDRA_PUBLIC_URL', 'http://identity.exwebsite.test:8090/'],
  ['HYDRA_PUBLIC_URL', 'https://127.0.0.1:14444/'],
  ['HYDRA_PUBLIC_URL', 'http://localhost:14444/'], ['HYDRA_PUBLIC_URL', 'http://127.1:14444/'],
  ['HYDRA_PUBLIC_URL', 'http://127.0.0.1:14444/?secret=private'], ['HYDRA_PUBLIC_URL', '%%%private'],
  ['HYDRA_ADMIN_URL', 'http://127.0.0.1:8080/'], ['HYDRA_ADMIN_URL', 'http://hydra:4445/'],
  ['OUTLINE_INTERNAL_URL', 'http://0.0.0.0:3102/'], ['OUTLINE_INTERNAL_URL', 'http://secret@127.0.0.1:3102/'],
  ['WEBSITE_INTERNAL_URL', 'http://127.0.0.1:8082/private'],
  ['OUTLINE_OIDC_CLIENT_ID', 'ex-outline'],
  ['OUTLINE_OIDC_REDIRECT_URI', 'http://127.0.0.1:8080/docs/auth/oidc.callback?private'],
  ['OUTLINE_INTEGRATION_KEY', 'private'], ['IDENTITY_DELIVERY_KEY', 'a'.repeat(63)],
  ['IDENTITY_BOOTSTRAP_KEY', 'g'.repeat(64)], ['IDENTITY_FLOW_KEY', 'a'.repeat(66)],
])('rejects malformed/conflicting %s without exposing its value', (name, value) => {
  let error: unknown
  try { parseIdentityConfig({ ...local, [name]: value }) } catch (caught) { error = caught }
  expect(error).toBeInstanceOf(IdentityConfigError)
  expect((error as Error).message).toMatch(/^IDENTITY_CONFIG_INVALID:[A-Z_]+$/)
  expect((error as Error).message).not.toContain('private')
})

it.each(['dev', 'full', undefined])('rejects local addresses in legacy %s mode', mode => {
  expect(() => parseIdentityConfig({ ...legacy, WEBSITE_INTEGRATION_MODE: mode,
    SERVER_PUBLIC_WEB_BASE_URL: 'http://127.0.0.1:8080' })).toThrow(IdentityConfigError)
  expect(() => parseIdentityConfig({ ...legacy, WEBSITE_INTEGRATION_MODE: mode,
    HYDRA_PUBLIC_URL: 'http://127.0.0.1:14444/' })).toThrow(IdentityConfigError)
})

it('accepts complete explicit previous-mode destinations without authorizing their identity keys', () => {
  const old = { 'ex-outline': { hydraAdminUrl: 'http://127.0.0.1:14445/',
    outlineInternalUrl: 'http://127.0.0.1:13000/', deliveryKey: 'e'.repeat(64) },
  'ex-oidc-probe': { hydraAdminUrl: 'http://127.0.0.1:14445/' } }
  const config = parseIdentityConfig({ ...local, IDENTITY_OUTBOX_TARGETS_JSON: JSON.stringify(old) })
  if (!config.enabled) throw new Error('expected enabled')
  expect(config.deliveryTargets['ex-outline']).toEqual(old['ex-outline'])
  expect(Object.keys(config.approvedClients)).toEqual(['ex-outline-local'])
  expect(Object.isFrozen(config.deliveryTargets['ex-outline'])).toBe(true)
})
it('allows full cleanup-only local transport through the literal host gateway without changing identity authorization', () => {
  const previous = { hydraAdminUrl: 'http://host.docker.internal:24447/', outlineInternalUrl: 'http://host.docker.internal:13102/', deliveryKey: 'e'.repeat(64) }
  const config = parseIdentityConfig({ ...legacy, WEBSITE_INTEGRATION_MODE: 'full', IDENTITY_OUTBOX_TARGETS_JSON: JSON.stringify({ 'ex-outline-local': previous }) })
  if (!config.enabled) throw new Error('expected enabled')
  expect(config.deliveryTargets['ex-outline-local']).toEqual(previous)
  expect(config.issuer).toBe('http://identity.exwebsite.test:8090/')
  expect(config.callback).toBe('http://exwebsite.test:8090/docs/auth/oidc.callback')
  expect(Object.keys(config.approvedClients)).toEqual(['ex-outline', 'ex-oidc-probe'])
  expect(config.keys.delivery).toBe(keys.IDENTITY_DELIVERY_KEY)
})
it.each(['dev', 'local', undefined])('rejects host gateway cleanup in every non-full caller mode %s', mode => {
  const previous = { hydraAdminUrl: 'http://host.docker.internal:24447/', outlineInternalUrl: 'http://host.docker.internal:13102/', deliveryKey: 'e'.repeat(64) }
  expect(() => parseIdentityConfig({ ...(mode === 'local' ? local : legacy), WEBSITE_INTEGRATION_MODE: mode,
    IDENTITY_OUTBOX_TARGETS_JSON: JSON.stringify({ 'ex-outline-local': previous }) })).toThrow(IdentityConfigError)
})
it.each(['http://host.docker.internal/', 'http://host.docker.internal:80/', 'https://host.docker.internal:24447/',
  'http://HOST.docker.internal:24447/', 'http://other.internal:24447/', 'http://host.docker.internal:24447/path',
  'http://host.docker.internal:24447/?secret=x', 'http://user@host.docker.internal:24447/', 'http://host.docker.internal:65536/'])
  ('rejects every non-literal or non-root full cleanup destination %s', destination => {
    for (const field of ['hydraAdminUrl', 'outlineInternalUrl']) {
      const previous = { hydraAdminUrl: 'http://host.docker.internal:24447/', outlineInternalUrl: 'http://host.docker.internal:13102/', deliveryKey: 'e'.repeat(64), [field]: destination }
      expect(() => parseIdentityConfig({ ...legacy, WEBSITE_INTEGRATION_MODE: 'full',
        IDENTITY_OUTBOX_TARGETS_JSON: JSON.stringify({ 'ex-outline-local': previous }) })).toThrow(IdentityConfigError)
    }
  })
it('keeps current local issuer/origin/internal identity roots loopback-only', () => {
  for (const field of ['SERVER_PUBLIC_WEB_BASE_URL', 'HYDRA_PUBLIC_URL', 'HYDRA_ADMIN_URL', 'OUTLINE_INTERNAL_URL', 'WEBSITE_INTERNAL_URL'])
    expect(() => parseIdentityConfig({ ...local, [field]: 'http://host.docker.internal:24447/' })).toThrow(IdentityConfigError)
})

it.each([
  '{private', '[]', 'null', JSON.stringify({ arbitrary: {} }),
  JSON.stringify({ 'ex-outline': { hydraAdminUrl: 'http://127.0.0.1:14445/' } }),
  JSON.stringify({ 'ex-outline': { hydraAdminUrl: 'http://127.0.0.1:14445/', outlineInternalUrl: 'http://127.0.0.1:3000/', deliveryKey: 'private' } }),
  JSON.stringify({ 'ex-outline-local': { hydraAdminUrl: 'http://127.0.0.1:14445/', outlineInternalUrl: 'http://127.0.0.1:3000/', deliveryKey: 'e'.repeat(64) } }),
  JSON.stringify({ 'ex-oidc-probe': { hydraAdminUrl: 'http://127.0.0.1:14445/', deliveryKey: 'e'.repeat(64) } }),
  JSON.stringify({ 'ex-oidc-probe': { hydraAdminUrl: 'http://127.0.0.1:14445/', extra: 'private' } }),
])('rejects unknown incomplete or overriding target configuration %#', raw => {
  expect(() => parseIdentityConfig({ ...local, IDENTITY_OUTBOX_TARGETS_JSON: raw }))
    .toThrow('IDENTITY_CONFIG_INVALID:IDENTITY_OUTBOX_TARGETS_JSON')
})
