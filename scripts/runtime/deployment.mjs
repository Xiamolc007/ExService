import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { digest, readJson, LocalError } from '../docs-integration/local-config.mjs'
import { verifyHydraClient, ensureHydraClient } from '../docs-integration/hydra-client.mjs'
import { readRuntimeConfiguration } from './configuration.mjs'

export function deploymentBinding(state) {
  return { version: 1, websiteTarget: state.config.websiteTarget, issuer: state.config.issuer, publicOrigin: state.config.publicOrigin,
    clientSecretFingerprint: digest(state.secrets.OUTLINE_OIDC_CLIENT_SECRET), deliveryFingerprint: digest(state.secrets.IDENTITY_DELIVERY_KEY) }
}
/** A read-only preflight refuses reused client IDs with unaccounted historical deliveries. */
export async function validateDeployment(state, { prepare = false, connect, verifyClient = verifyHydraClient } = {}) {
  const path = join(state.workspace, '.local/runtime-deployment/identity.json'), binding = deploymentBinding(state)
  const existing = existsSync(path) ? readJson(path) : undefined
  if (existing && digest(existing) !== digest(binding)) throw new LocalError('DEPLOYMENT_IDENTITY_MIGRATION_REQUIRED', 'drain the original issuer before an explicitly reviewed identity migration')
  const factory = connect ?? (async url => { const { default: pg } = await import('pg'); const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 }); await client.connect(); return client })
  for (const [name, url] of [['exre', state.website.DATABASE_URL], ['outline', state.values.OUTLINE_DATABASE_URL]]) {
    let client
    try {
      client = await factory(url); await client.query('BEGIN READ ONLY')
      if ((await client.query('SELECT current_database() AS name')).rows[0]?.name !== name) throw new LocalError('DEPLOYMENT_DATABASE_IDENTITY_CONFLICT')
      if (name === 'exre' && !existing) {
        const old = await client.query(`SELECT 1 FROM auth_oidc_bindings WHERE client_id='ex-outline' AND revoked_at IS NULL
          UNION ALL SELECT 1 FROM auth_oidc_flows WHERE client_id='ex-outline' AND expires_at > $1
          UNION ALL SELECT 1 FROM auth_identity_outbox WHERE completed_at IS NULL AND target_bindings LIKE '%ex-outline%' LIMIT 1`, [Date.now()])
        if (old.rows.length) throw new LocalError('DEPLOYMENT_OLD_IDENTITY_PENDING', 'deliver/revoke the original issuer targets, or explicitly prepare a separate Website database')
      }
      if (name === 'outline') {
        const present = (await client.query("SELECT to_regclass('public.website_integrations') AS name")).rows[0]?.name
        if (present) {
          const markers = (await client.query('SELECT issuer FROM website_integrations')).rows
          if (markers.length > 1 || markers.some(marker => marker.issuer !== binding.issuer) || (!prepare && !markers.length)) throw new LocalError('DEPLOYMENT_OUTLINE_ISSUER_CONFLICT')
        } else if (!prepare) throw new LocalError('DEPLOYMENT_OUTLINE_NOT_PREPARED')
      }
      await client.query('ROLLBACK')
    } catch (error) { throw error instanceof LocalError ? error : new LocalError('DEPLOYMENT_DATABASE_NOT_READY', 'explicitly migrate the selected deployment targets') }
    finally { await client?.end().catch(() => {}) }
  }
  if (prepare && !existing) {
    mkdirSync(join(state.workspace, '.local/runtime-deployment'), { recursive: true })
    try { writeFileSync(path, JSON.stringify(binding), { flag: 'wx', mode: 0o600 }) }
    catch (error) {
      // Concurrent preparation must never replace a routing identity already selected by another operator.
      if (error.code !== 'EEXIST' || digest(readJson(path)) !== digest(binding))
        throw new LocalError('DEPLOYMENT_IDENTITY_MIGRATION_REQUIRED')
    }
  }
  else if (!prepare) {
    if (!existing) throw new LocalError('DEPLOYMENT_BINDING_MISSING', 'node scripts/runtime/deployment.mjs prepare')
    try { await verifyClient({ mode: 'deployment', adminUrl: state.values.HYDRA_ADMIN_URL, publicUrl: state.config.issuer,
      publicOrigin: state.config.publicOrigin, clientId: 'ex-outline', callback: state.config.callback, clientSecret: state.secrets.OUTLINE_OIDC_CLIENT_SECRET }) }
    catch { throw new LocalError('DEPLOYMENT_HYDRA_NOT_READY', 'explicitly provision the exact deployment Docs client') }
  }
  return binding
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!['validate', 'prepare', 'client'].includes(process.argv[2]) || process.argv.length !== 3) throw new LocalError('DEPLOYMENT_ARGUMENTS_INVALID')
    const state = readRuntimeConfiguration({ profile: 'deployment' })
    if (process.argv[2] === 'client') {
      const binding = readJson(join(state.workspace, '.local/runtime-deployment/identity.json'))
      if (digest(binding) !== digest(deploymentBinding(state))) throw new LocalError('DEPLOYMENT_IDENTITY_MIGRATION_REQUIRED')
      await ensureHydraClient({ mode: 'deployment', adminUrl: state.values.HYDRA_ADMIN_URL, publicUrl: state.config.issuer,
        publicOrigin: state.config.publicOrigin, clientId: 'ex-outline', callback: state.config.callback, clientSecret: state.secrets.OUTLINE_OIDC_CLIENT_SECRET })
    } else await validateDeployment(state, { prepare: process.argv[2] === 'prepare' })
    console.log('DEPLOYMENT_CONFIGURATION_VALIDATED')
  } catch (error) { console.error(error instanceof LocalError ? error.message : 'DEPLOYMENT_VALIDATION_FAILED'); process.exitCode = 1 }
}
