import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { parseIdentityConfig } from '@server/src/identity/config'
import { assertDeploymentBinding } from '@server/src/identity/deployment-binding'

it('requires a matching deployment routing receipt before outbox startup, without secret errors', () => {
  const directory = mkdtempSync(join(tmpdir(), 'website-deployment-')), file = join(directory, 'identity.json')
  const key = 'a'.repeat(64), env = { WEBSITE_INTEGRATION_ENABLED: 'true', WEBSITE_INTEGRATION_MODE: 'deployment',
    SERVER_PUBLIC_WEB_BASE_URL: 'https://site.example', HYDRA_PUBLIC_URL: 'https://issuer.example/',
    HYDRA_ADMIN_URL: 'http://hydra:4445/', OUTLINE_INTERNAL_URL: 'http://outline:3000/', WEBSITE_INTERNAL_URL: 'http://server:8080/',
    OUTLINE_INTEGRATION_KEY: key, IDENTITY_BOOTSTRAP_KEY: key, IDENTITY_FLOW_KEY: key, IDENTITY_DELIVERY_KEY: key,
    OUTLINE_OIDC_CLIENT_SECRET: key, DATABASE_URL: 'postgres://website:secret@postgres:5432/exre', IDENTITY_DEPLOYMENT_RECEIPT_FILE: file }
  const identity = parseIdentityConfig(env), hash = createHash('sha256').update(key).digest('hex')
  try {
    expect(() => assertDeploymentBinding(identity, env)).toThrow('IDENTITY_DEPLOYMENT_RECEIPT_FILE')
    writeFileSync(file, JSON.stringify({ version: 1, issuer: 'https://issuer.example/', publicOrigin: 'https://site.example',
      websiteTarget: { host: 'postgres', port: 5432, user: 'website', database: 'exre', verifiedDatabase: 'exre' },
      clientSecretFingerprint: hash, deliveryFingerprint: hash }))
    expect(() => assertDeploymentBinding(identity, env)).not.toThrow()
    expect(() => assertDeploymentBinding(identity, { ...env, OUTLINE_OIDC_CLIENT_SECRET: 'changed-secret' })).toThrow('IDENTITY_DEPLOYMENT_RECEIPT_FILE')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
