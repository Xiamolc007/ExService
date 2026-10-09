import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { IdentityConfig } from './config.js'
import { IdentityConfigError } from './config.js'

const fingerprint = (value: string | undefined): string => createHash('sha256').update(value ?? '').digest('hex')

/** Pins deployment routing before any worker can deliver a historical outbox event. */
export function assertDeploymentBinding(identity: IdentityConfig | Readonly<{ enabled: false }>, env: NodeJS.ProcessEnv = process.env): void {
  if (!identity.enabled || identity.mode !== 'deployment') return
  try {
    if (!env.IDENTITY_DEPLOYMENT_RECEIPT_FILE) throw new Error()
    const receipt: unknown = JSON.parse(readFileSync(env.IDENTITY_DEPLOYMENT_RECEIPT_FILE, 'utf8'))
    if (!receipt || typeof receipt !== 'object') throw new Error()
    const value = receipt as Record<string, unknown>, database = new URL(env.DATABASE_URL!)
    const target = value.websiteTarget as Record<string, unknown> | undefined
    if (value.version !== 1 || value.issuer !== identity.issuer || value.publicOrigin !== identity.publicOrigin ||
      value.clientSecretFingerprint !== fingerprint(env.OUTLINE_OIDC_CLIENT_SECRET) || value.deliveryFingerprint !== fingerprint(identity.keys.delivery) ||
      target?.host !== database.hostname.toLowerCase() || target?.port !== Number(database.port || 5432) ||
      target?.user !== decodeURIComponent(database.username) || target?.database !== 'exre' || target?.verifiedDatabase !== 'exre') throw new Error()
  } catch { throw new IdentityConfigError('IDENTITY_DEPLOYMENT_RECEIPT_FILE') }
}
