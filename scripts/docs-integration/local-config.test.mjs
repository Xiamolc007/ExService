import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureLocal, digest, loadLocal, localEnvironments, otherOutboxTargets, secretNames, websiteEnvironment, websiteTarget } from './local-config.mjs'
import { parseCommandArguments } from './command.mjs'

async function fixture(run) {
  const workspace = mkdtempSync(join(tmpdir(), 'local-config-')), directory = join(workspace, 'local')
  mkdirSync(join(workspace, 'apps/server'), { recursive: true })
  const original = 'DATABASE_URL=postgres://original:original-secret@127.0.0.1:5432/exre\nAUTH_CODE_HMAC_KEY=original-hmac\nSERVER_AVATAR_DIRECTORY=original-avatars\n'
  writeFileSync(join(workspace, 'apps/server/.env.local'), original)
  const options = { workspace, directory, inherited: {}, validateTools() {}, async verifyDatabase() {} }
  try { await run({ workspace, directory, options, original }) }
  finally { rmSync(workspace, { recursive: true, force: true }) }
}
test('local configure is idempotent, stable, and never copies or overwrites Website secrets/storage', async () => fixture(async f => {
  const first = await configureLocal(f.options), before = readFileSync(join(f.directory, 'secrets.env'), 'utf8')
  const second = await configureLocal(f.options)
  assert.equal(first.fingerprint, second.fingerprint)
  assert.equal(readFileSync(join(f.directory, 'secrets.env'), 'utf8'), before)
  assert.equal(readFileSync(join(f.workspace, 'apps/server/.env.local'), 'utf8'), f.original)
  const disk = readFileSync(join(f.directory, 'config.json'), 'utf8') + before
  assert.doesNotMatch(disk, /original-secret|original-hmac|DATABASE_URL|AUTH_CODE_HMAC_KEY/)
  const env = localEnvironments(loadLocal({ ...f.options, checkEnvironment: false }), {})
  assert.equal(env.server.DATABASE_URL, 'postgres://original:original-secret@127.0.0.1:5432/exre')
  assert.equal(env.server.SERVER_AVATAR_DIRECTORY, 'original-avatars')
  assert.equal(env.outline.OUTLINE_OIDC_CLIENT_ID, 'ex-outline-local')
  assert.equal(env.outline.URL, 'http://127.0.0.1:8080/docs')
}))
test('process env has original Node env-file precedence and changed targets/stale ports refuse', async () => fixture(async f => {
  const environment = websiteEnvironment(f.workspace, { DATABASE_URL: 'postgres://override:secret@127.0.0.1:15432/exre' })
  assert.equal(websiteTarget(environment).port, 15432)
  await configureLocal(f.options)
  assert.throws(() => loadLocal({ ...f.options, inherited: { WEBSITE_DEV_ENTRY_PORT: '9999' } }), /STALE_PORT/)
  assert.throws(() => loadLocal({ ...f.options, inherited: { DATABASE_URL: environment.DATABASE_URL } }), /TARGET_CHANGED/)
  assert.throws(() => websiteTarget({ ...environment, DATABASE_URL: 'postgres://user:password@127.0.0.1:5432/outline' }), /DATABASE_INVALID/)
}))
test('explicit port reconfigure preserves secrets and rejects colliding or malformed layouts', async () => fixture(async f => {
  await configureLocal(f.options)
  const before = readFileSync(join(f.directory, 'secrets.env'), 'utf8')
  const next = await configureLocal({ ...f.options, ports: { public: 8180 } })
  assert.equal(next.config.callback, 'http://127.0.0.1:8180/docs/auth/oidc.callback')
  assert.equal(readFileSync(join(f.directory, 'secrets.env'), 'utf8'), before)
  await assert.rejects(configureLocal({ ...f.options, ports: { public: 8081 } }), /PORT_CONFLICT/)
  const altered = { ...next.config, issuer: 'http://localhost:14444/' }
  writeFileSync(join(f.directory, 'config.json'), JSON.stringify(altered))
  await assert.rejects(configureLocal(f.options), /LAYOUT_INVALID/)
}))
test('partial or malformed config and secrets are never silently repaired or re-keyed', async () => fixture(async f => {
  await configureLocal(f.options)
  writeFileSync(join(f.directory, 'secrets.env'), 'OUTLINE_PASSWORD=broken\n')
  await assert.rejects(configureLocal(f.options), /SECRETS_INVALID/)
  rmSync(join(f.directory, 'secrets.env'))
  await assert.rejects(configureLocal(f.options), /CONFIG_PARTIAL/)
}))
test('configure validates connection identity but does not require migrated Website schema', async () => fixture(async f => {
  let verified = 0
  await configureLocal({ ...f.options, verifyDatabase: async () => { verified++ } })
  assert.equal(verified, 1)
  assert.equal(digest(websiteTarget(websiteEnvironment(f.workspace, {}))).length, 64)
}))
test('arguments preserve original no-mode commands and reject ambiguous/repair/extra flags', () => {
  assert.equal(parseCommandArguments('init', []).mode, undefined)
  assert.deepEqual(parseCommandArguments('configure', ['--', '--mode', 'local', '--hydra-public-port', '15444']).ports, { hydraPublic: 15444 })
  for (const args of [['--mode', 'evil'], ['--mode', 'local', '--mode', 'local'], ['--mode'], ['--force', 'true'], ['--mode', 'local', 'extra']])
    assert.throws(() => parseCommandArguments('init', args))
  assert.throws(() => parseCommandArguments('bootstrap', []), /UUID_REQUIRED/)
  assert.throws(() => parseCommandArguments('bootstrap', ['--mode', 'local', '--admin-user-id', 'not-uuid']))
  assert.throws(() => parseCommandArguments('up', ['--mode', 'local']), /LOCAL_START_COMMAND/)
})
test('missing or partial legacy original sources never receive current keys or port guesses', async () => fixture(async f => {
  assert.equal(otherOutboxTargets('local', f.workspace, {}), undefined)
  mkdirSync(join(f.workspace, '.local/docs-integration'), { recursive: true })
  writeFileSync(join(f.workspace, '.local/docs-integration/dev.env'), 'OUTLINE_BACKEND_UPSTREAM=host.docker.internal:13100\n')
  assert.equal(otherOutboxTargets('local', f.workspace, {}), undefined)
  const complete = [...new Set([...secretNames, 'EXRE_PASSWORD', 'AUTH_CODE_HMAC_KEY', 'OIDC_PROBE_CLIENT_SECRET'])].map(key => `${key}=${'a'.repeat(64)}`).join('\n')
  writeFileSync(join(f.workspace, '.local/docs-integration/dev.env'), complete + '\nOUTLINE_BACKEND_UPSTREAM=host.docker.internal:13102\nOUTLINE_HTTP_PORT=13102\nOUTLINE_DIRECT_UPSTREAM=host.docker.internal:13100\nWEBSITE_SERVER_UPSTREAM=host.docker.internal:18180\nWEBSITE_WEB_UPSTREAM=host.docker.internal:18181\nOUTLINE_STATIC_UPSTREAM=host.docker.internal:13101\n')
  const targets = JSON.parse(otherOutboxTargets('local', f.workspace, {}))
  assert.equal(targets['ex-outline'].deliveryKey, 'a'.repeat(64))
  assert.equal(targets['ex-oidc-probe'].hydraAdminUrl, 'http://127.0.0.1:14445/')
}))
test('full cleanup transport derives only the complete original local ports/key while host dev retains loopback', async () => fixture(async f => {
  const directory = join(f.workspace, '.local/docs-integration/local-dev')
  const state = await configureLocal({ ...f.options, directory, ports: { hydraAdmin: 24447, outline: 23102 } })
  const original = readFileSync(join(directory, 'config.json'), 'utf8')
  const full = JSON.parse(otherOutboxTargets('full', f.workspace, {}))['ex-outline-local']
  assert.deepEqual(full, { hydraAdminUrl: 'http://host.docker.internal:24447/', outlineInternalUrl: 'http://host.docker.internal:23102/', deliveryKey: state.secrets.IDENTITY_DELIVERY_KEY })
  assert.equal(JSON.parse(otherOutboxTargets('dev', f.workspace, {}))['ex-outline-local'].hydraAdminUrl, 'http://127.0.0.1:24447/')
  assert.equal(readFileSync(join(directory, 'config.json'), 'utf8'), original)
  assert.equal(otherOutboxTargets('local', f.workspace, {}), undefined)
}))
