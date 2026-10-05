import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defaults, secretNames, digest } from '../docs-integration/local-config.mjs'
import { readRuntimeConfiguration, validateReceipt, environmentFile } from './configuration.mjs'
import { importExisting, configureRuntime, receiptFor, serializeEnvironment } from './configure.mjs'
import { serverSpecification } from './server.mjs'
import { buildSpecifications, main as build } from './build.mjs'
import { parseRuntimeArguments } from './command.mjs'
import { root } from '../docs-integration/configure.mjs'

function fixture(t) {
  const workspace = mkdtempSync(join(tmpdir(), 'exwebsite-runtime-'))
  t.after(() => rmSync(workspace, { recursive: true, force: true }))
  const directory = join(workspace, '.local/docs-integration/local-dev')
  mkdirSync(directory, { recursive: true }); mkdirSync(join(workspace, 'apps/server'), { recursive: true })
  const secrets = Object.fromEntries(secretNames.map((key, index) => [key, (index + 1).toString(16).repeat(64)]))
  const website = { DATABASE_URL: 'postgres://existing:original-secret@127.0.0.1:5432/exre', AUTH_CODE_HMAC_KEY: 'f'.repeat(64),
    TENCENT_COS_SECRET_ID: 'cos-id', TENCENT_COS_SECRET_KEY: 'cos-sentinel', TENCENT_COS_REGION: 'region', TENCENT_COS_BUCKET: 'bucket', STORAGE_UPLOAD_HMAC_KEY: 'e'.repeat(64) }
  const config = { version: 1, mode: 'local', project: 'exwebsite-local-dev', ports: { ...defaults }, publicOrigin: 'http://127.0.0.1:8080',
    issuer: 'http://127.0.0.1:14444/', callback: 'http://127.0.0.1:8080/docs/auth/oidc.callback', clientId: 'ex-outline-local',
    storage: join(directory, 'data/outline'), websiteTarget: { host: '127.0.0.1', port: 5432, database: 'exre', user: 'existing', verifiedDatabase: 'exre' } }
  writeFileSync(join(directory, 'config.json'), JSON.stringify(config)); writeFileSync(join(directory, 'secrets.env'), serializeEnvironment(secrets))
  writeFileSync(join(workspace, 'apps/server/.env.local'), serializeEnvironment({ ...website, UNKNOWN_SETTING: 'preserve-me' }))
  const values = { ...website, ...secrets, RUNTIME_CONFIG_VERSION: '2', RUNTIME_PROFILE: 'local' }
  return { workspace, directory, secrets, website, config, values }
}
const acquire = () => ({ record: { runId: '00000000-0000-4000-8000-000000000000', identity: {} }, release() {}, update() {} })
test('root exposes only the agreed commands while Server maintenance tools remain available', () => {
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'))).scripts
  assert.deepEqual(Object.keys(scripts).sort(), ['start', 'dev', 'stop', 'infra', 'api:lint', 'api:generate', 'typecheck', 'test', 'build', 'db:migrate', 'db:reset'].sort())
  const server = JSON.parse(readFileSync(join(root, 'apps/server/package.json'))).scripts
  for (const name of ['sso:create', 'sso:inspect', 'auth:disable', 'auth:enable']) assert.ok(server[name].includes(`server.mjs ${name}`))
})

test('root configuration honors explicit values including empty, rejects stale targets and never inherits secrets into Web', t => {
  const f = fixture(t); writeFileSync(join(f.workspace, '.env.local'), serializeEnvironment(f.values))
  const state = readRuntimeConfiguration({ workspace: f.workspace, inherited: { STORAGE_MAX_BYTES: '1234', UNRELATED_SECRET: 'sentinel' } })
  assert.equal(state.website.STORAGE_MAX_BYTES, '1234'); assert.equal(state.website.DATABASE_URL, f.website.DATABASE_URL)
  for (const key of [...secretNames, 'DATABASE_URL', 'AUTH_CODE_HMAC_KEY', 'TENCENT_COS_SECRET_KEY', 'UNRELATED_SECRET']) assert.equal(state.environments.web[key], undefined)
  assert.equal(state.environments.outline.DATABASE_URL.includes('/outline'), true)
  assert.equal(state.environments.hydra.DSN.includes('/hydra'), true)
  assert.throws(() => readRuntimeConfiguration({ workspace: f.workspace, inherited: { DATABASE_URL: '' } }), /WEBSITE_DATABASE_INVALID/)
  assert.throws(() => readRuntimeConfiguration({ workspace: f.workspace, inherited: { INTEGRATION_WEB_PORT: '9000' } }), /ASSERTION_CONFLICT/)
  assert.throws(() => readRuntimeConfiguration({ workspace: f.workspace, inherited: { LOCAL_WEB_PORT: '8080' } }), /PORTS_INVALID/)
  assert.throws(() => readRuntimeConfiguration({ workspace: f.workspace, inherited: { RUNTIME_PROFILE: 'deployment' } }), /RUNTIME_INVALID_PUBLIC_ORIGIN/)
})
test('v1 import preserves original fingerprint, targets, secrets, all receipts and unknown Website keys', async t => {
  const f = fixture(t), original = readFileSync(join(f.directory, 'secrets.env'), 'utf8')
  const prepared = { fingerprint: digest({ config: f.config, secrets: f.secrets }), stages: { initialized: true, bootstrap: true }, adminUserId: 'chosen-id', volumes: [{ name: 'old', proof: 'original' }] }
  writeFileSync(join(f.directory, 'prepared.json'), JSON.stringify(prepared))
  const state = await importExisting({ workspace: f.workspace, inherited: {}, acquire, async verifyDatabase() {}, verify() {} })
  assert.equal(state.fingerprint, prepared.fingerprint); assert.deepEqual(state.secrets, f.secrets)
  assert.equal(readFileSync(join(f.directory, 'secrets.env'), 'utf8'), original)
  assert.deepEqual(JSON.parse(readFileSync(join(f.directory, 'prepared.json'))), prepared)
  assert.equal(environmentFile(join(f.workspace, '.env.local')).UNKNOWN_SETTING, 'preserve-me')
  validateReceipt(state)
  assert.equal((await importExisting({ workspace: f.workspace, inherited: {}, acquire, async verifyDatabase() {}, verify() {} })).fingerprint, state.fingerprint)
  assert.throws(() => validateReceipt({ ...state, fingerprint: 'changed' }), /RECEIPT_CONFLICT/)
})
test('import conflicts report key names only and do not write or rotate secrets', async t => {
  const f = fixture(t); writeFileSync(join(f.workspace, '.env.local'), 'AUTH_CODE_HMAC_KEY=secret-conflict\n')
  await assert.rejects(importExisting({ workspace: f.workspace, inherited: {}, acquire, async verifyDatabase() {}, verify() {} }), error =>
    error.message.includes('AUTH_CODE_HMAC_KEY') && !error.message.includes('secret-conflict'))
  assert.equal(environmentFile(join(f.workspace, '.env.local')).AUTH_CODE_HMAC_KEY, 'secret-conflict')
})

test('import verifies the live Website target before creating any upgrade journal', async t => {
  const f = fixture(t), original = readFileSync(join(f.directory, 'config.json'), 'utf8')
  await assert.rejects(importExisting({ workspace: f.workspace, inherited: {}, acquire, verify() {},
    async verifyDatabase(environment) {
      assert.equal(environment.DATABASE_URL, f.website.DATABASE_URL)
      throw new Error('database unavailable')
    } }), /database unavailable/)
  assert.equal(readFileSync(join(f.directory, 'config.json'), 'utf8'), original)
  assert.throws(() => readFileSync(join(f.directory, 'upgrade.json')), /ENOENT/)
})
for (const stage of ['journal', 'temporary', 'environment', 'receipt']) test(`interrupted import after ${stage} refuses normal use and recovers the same transaction`, async t => {
  const f = fixture(t)
  await assert.rejects(importExisting({ workspace: f.workspace, inherited: {}, acquire, async verifyDatabase() {}, verify() {}, checkpoint(at) { if (at === stage) throw new Error('interrupted') } }))
  if (['environment', 'receipt'].includes(stage)) {
    const state = readRuntimeConfiguration({ workspace: f.workspace, inherited: {} })
    assert.throws(() => validateReceipt(state), /UPGRADE_INCOMPLETE/)
  }
  const state = await importExisting({ workspace: f.workspace, inherited: {}, acquire, async verifyDatabase() {}, verify() {} }); validateReceipt(state)
  assert.equal(state.fingerprint, digest({ config: f.config, secrets: f.secrets }))
})
test('changing original files after interrupted import cannot acquire new ownership', async t => {
  const f = fixture(t)
  await assert.rejects(importExisting({ workspace: f.workspace, inherited: {}, acquire, async verifyDatabase() {}, verify() {}, checkpoint() { throw new Error() } }))
  writeFileSync(join(f.workspace, 'apps/server/.env.local'), serializeEnvironment({ ...f.website, AUTH_CODE_HMAC_KEY: 'a'.repeat(64) }))
  await assert.rejects(importExisting({ workspace: f.workspace, inherited: {}, acquire, async verifyDatabase() {}, verify() {} }), /SOURCE_CHANGED/)
})
test('fresh explicit configure fills only missing document keys and repeats without rotating them', async t => {
  const f = fixture(t)
  rmSync(join(f.directory, 'config.json')); rmSync(join(f.directory, 'secrets.env'))
  writeFileSync(join(f.workspace, '.env.local'), serializeEnvironment({ ...f.website, RUNTIME_CONFIG_VERSION: '2', RUNTIME_PROFILE: 'local', OUTLINE_SECRET_KEY: f.secrets.OUTLINE_SECRET_KEY }))
  const options = { workspace: f.workspace, inherited: {}, acquire, validateTools() {}, async verifyDatabase() {}, verifyOwnership() {} }
  const first = await configureRuntime(options), second = await configureRuntime(options)
  assert.deepEqual(first.secrets, second.secrets); assert.equal(first.secrets.OUTLINE_SECRET_KEY, f.secrets.OUTLINE_SECRET_KEY)
  validateReceipt(second)
})
test('Server adapter uses mapped root configuration and keeps CLI args without package env-file fallback', t => {
  const f = fixture(t); writeFileSync(join(f.workspace, '.env.local'), serializeEnvironment(f.values))
  const spec = serverSpecification('db:reset', ['--', '--confirm', 'exre'], { workspace: f.workspace, inherited: {} })
  assert.deepEqual(spec.args, ['--import', 'tsx', 'src/db/reset.ts', '--confirm', 'exre'])
  assert.equal(spec.environment.DATABASE_URL, f.website.DATABASE_URL)
  for (const action of ['sso:create', 'sso:inspect', 'auth:disable', 'auth:enable']) assert.equal(serverSpecification(action, [], { workspace: f.workspace, inherited: {} }).args.includes('--env-file-if-exists=.env.local'), false)
})
test('command parser rejects legacy modes, repeated flags, missing UUID and extra arguments', () => {
  assert.deepEqual(parseRuntimeArguments(['infra', '--', 'configure', '--import-existing']), { command: 'infra', action: 'configure', importExisting: true })
  for (const args of [['start', '--mode', 'local'], ['stop', 'all'], ['infra', 'bootstrap'], ['infra', 'configure', '--import-existing', '--import-existing'], ['infra', 'init', 'extra']]) assert.throws(() => parseRuntimeArguments(args))
})
test('complete build needs no root config or DB; secrets do not reach either build and failure stops later stages', async t => {
  const f = fixture(t), corepack = join(f.workspace, 'corepack.js'); writeFileSync(corepack, '')
  const specs = buildSpecifications({ workspace: f.workspace, inherited: { INTEGRATION_COREPACK_JS: corepack, DATABASE_URL: 'secret', NODE_ENV: 'development' } })
  assert.equal(specs.length, 7); assert.ok(specs.slice(3).every(spec => spec.cwd === join(f.workspace, 'apps/outline')))
  assert.ok(specs.every(spec => spec.environment.DATABASE_URL === undefined && spec.environment.NODE_ENV === 'production'))
  const ran = []
  await assert.rejects(build({ workspace: f.workspace, inherited: { INTEGRATION_COREPACK_JS: corepack } }, async spec => { ran.push(spec.name); if (ran.length === 2) throw new Error() }), /RUNTIME_BUILD_FAILED:@workspace\/web/)
  assert.equal(ran.length, 2)
})
