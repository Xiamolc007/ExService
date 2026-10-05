import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateDeployment } from './deployment.mjs'

function fixture(t, pending = false) {
  const workspace = mkdtempSync(join(tmpdir(), 'exwebsite-deployment-'))
  t.after(() => rmSync(workspace, { recursive: true, force: true }))
  const state = { workspace, config: { websiteTarget: { database: 'exre' }, publicOrigin: 'https://site.example', issuer: 'https://issuer.example/' },
    secrets: { OUTLINE_OIDC_CLIENT_SECRET: 'secret', IDENTITY_DELIVERY_KEY: 'delivery' }, website: { DATABASE_URL: 'exre' },
    values: { OUTLINE_DATABASE_URL: 'outline', HYDRA_ADMIN_URL: 'http://hydra:4445' } }
  const queries = [], connect = async name => ({ async query(sql) {
    queries.push(sql)
    return { rows: sql.includes('current_database') ? [{ name }] : sql.includes('UNION ALL') ? (pending ? [{}] : []) :
      sql.includes('to_regclass') ? [{ name: 'website_integrations' }] : sql.includes('SELECT issuer') ? [{ issuer: state.config.issuer }] : [] }
  }, async end() {} })
  return { state, connect, queries, verifyClient: async () => {} }
}
test('deployment prepare rejects unaccounted old ex-outline identities using read-only queries', async t => {
  const f = fixture(t, true)
  await assert.rejects(validateDeployment(f.state, { ...f, prepare: true }), /OLD_IDENTITY_PENDING/)
  assert.ok(f.queries.every(sql => /^(BEGIN READ ONLY|ROLLBACK|SELECT)/.test(sql)))
})
test('deployment pins identity and refuses issuer/secret changes on subsequent validation', async t => {
  const f = fixture(t); await validateDeployment(f.state, { ...f, prepare: true }); await validateDeployment(f.state, f)
  f.state.secrets.OUTLINE_OIDC_CLIENT_SECRET = 'changed'
  await assert.rejects(validateDeployment(f.state, f), /IDENTITY_MIGRATION_REQUIRED/)
})

test('concurrent prepare cannot overwrite a different deployment routing binding', async t => {
  const f = fixture(t), different = { ...f.state, secrets: { ...f.state.secrets, OUTLINE_OIDC_CLIENT_SECRET: 'other' } }
  const outcomes = await Promise.allSettled([
    validateDeployment(f.state, { ...f, prepare: true }),
    validateDeployment(different, { ...f, prepare: true }),
  ])
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1)
  assert.match(outcomes.find(result => result.status === 'rejected').reason.message, /IDENTITY_MIGRATION_REQUIRED/)
  await validateDeployment(f.state, f)
})
