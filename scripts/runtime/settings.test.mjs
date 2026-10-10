import test from 'node:test'
import { parseEnv } from 'node:util'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { readRuntimeConfiguration, databaseUrl, defaults } from './settings.mjs'
import { convertValues, convertConfiguration, serializeEnvironment, verifyOriginalTargets } from './convert.mjs'
import { redact, diagnostic, reporter } from './output.mjs'
import { composeEnvironment, Services } from './services.mjs'
import { root } from './shared.mjs'
import { NativeApplications } from './native.mjs'
import { processSpecification, processRecord } from './pm2-process.mjs'
import { nginxConfiguration } from './nginx.mjs'
import { logWriter } from './logs.mjs'
import { parseRuntimeArguments } from './entry.mjs'
import { testSpecifications, runTests } from './tests.mjs'
import { buildSpecifications, main as build } from './build.mjs'
import { serverSpecification } from './server.mjs'
import { verifyHydraBinary, initializeDocumentDatabases } from './infrastructure.mjs'

function fixture(t, profile = 'local') {
  const workspace = mkdtempSync(join(tmpdir(), 'runtime-fields-'))
  t.after(() => rmSync(workspace, { recursive: true, force: true }))
  const values = { RUNTIME_PROFILE: profile, AUTH_CODE_HMAC_KEY: 'a'.repeat(64), POSTGRES_PASSWORD: 'readable admin',
    OUTLINE_OIDC_CLIENT_SECRET: 'readable client', OUTLINE_UTILS_SECRET: 'original-utils',
    ...Object.fromEntries(['OUTLINE_SECRET_KEY', 'HYDRA_SYSTEM_SECRET', 'OUTLINE_INTEGRATION_KEY', 'IDENTITY_BOOTSTRAP_KEY', 'IDENTITY_DELIVERY_KEY', 'IDENTITY_FLOW_KEY']
      .map((key, index) => [key, String(index + 1).repeat(64)])),
    ...Object.fromEntries(['DATABASE', 'OUTLINE_DATABASE', 'HYDRA_DATABASE'].flatMap((prefix, index) => Object.entries({
      HOST: '127.0.0.1', PORT: '5432', NAME: ['exre', 'outline', 'hydra'][index], USER: ['website', 'outline', 'hydra'][index],
      PASSWORD: 'p@:%/# $汉字', SSLMODE: 'disable' }).map(([field, value]) => [`${prefix}_${field}`, value]))),
  }
  if (profile === 'deployment') Object.assign(values, { PUBLIC_ORIGIN: 'https://site.example', HYDRA_PUBLIC_URL: 'https://issuer.example/',
    HYDRA_ADMIN_URL: 'http://127.0.0.1:4445/', WEBSITE_INTERNAL_URL: 'http://127.0.0.1:8082/', OUTLINE_INTERNAL_URL: 'http://127.0.0.1:3102/',
    OUTLINE_REDIS_URL: 'redis://127.0.0.1:6379', OUTLINE_STORAGE_DIRECTORY: join(workspace, 'attachments'), HYDRA_BINARY: join(workspace, 'hydra') })
  const save = () => writeFileSync(join(workspace, '.env.local'), serializeEnvironment(values))
  save()
  return { workspace, values, save, read: inherited => readRuntimeConfiguration({ workspace, inherited: inherited ?? {} }) }
}

test('root-only component settings preserve short passwords, encoding, process overrides and service boundaries', t => {
  const f = fixture(t)
  mkdirSync(join(f.workspace, 'apps/server'), { recursive: true })
  writeFileSync(join(f.workspace, 'apps/server/.env.local'), 'DATABASE_URL=should-never-read\n')
  const state = f.read({ DATABASE_PASSWORD: 'x', SERVER_NOTIFICATION_TOKEN_KEY: 'f'.repeat(64), UNKNOWN_SECRET: 'private' })
  assert.equal(decodeURIComponent(new URL(state.website.DATABASE_URL).password), 'x')
  assert.equal(state.environments.server.SERVER_NOTIFICATION_TOKEN_KEY, 'f'.repeat(64))
  assert.equal(decodeURIComponent(new URL(state.environments.outline.DATABASE_URL).password), f.values.OUTLINE_DATABASE_PASSWORD)
  assert.deepEqual(state.config.ports, defaults)
  for (const name of ['DATABASE_URL', 'AUTH_CODE_HMAC_KEY', 'OUTLINE_OIDC_CLIENT_SECRET', 'SERVER_NOTIFICATION_TOKEN_KEY', 'UNKNOWN_SECRET']) assert.equal(state.environments.web[name], undefined)
  assert.equal(state.environments.web.VITE_API_BASE_URL, '/api')
  assert.equal(state.environments.hydra.OUTLINE_INTEGRATION_KEY, undefined)
  f.values.STORAGE_MAX_BYTES = '4096'; f.save()
  assert.equal(f.read().website.STORAGE_MAX_BYTES, '4096') // No configure or receipt after a normal change.
})

test('invalid profile, old sources, duplicate ports, names and cryptographic keys fail without revealing values', t => {
  const f = fixture(t)
  for (const override of [{ DATABASE_URL: 'private-url' }, { RUNTIME_CONFIG_VERSION: '2' }, { DATABASE_NAME: 'outline' },
    { DATABASE_PASSWORD: '' }, { LOCAL_REDIS_PORT: '5432' }, { AUTH_CODE_HMAC_KEY: 'private-key' },
    { SERVER_NOTIFICATION_TOKEN_KEY: 'short-key' }, { RUNTIME_PROFILE: 'old' }]) {
    assert.throws(() => f.read(override), error => !error.message.includes('private-url') && !error.message.includes('private-key') && !error.message.includes('short-key'))
  }
})

test('deployment uses independently configured database hosts and explicit application ports', t => {
  const f = fixture(t, 'deployment')
  const state = f.read({ OUTLINE_DATABASE_HOST: 'outline-db.example', HYDRA_DATABASE_HOST: 'hydra-db.example', SERVER_PORT: '18080', OUTLINE_PORT: '13000',
    WEBSITE_INTERNAL_URL: 'http://127.0.0.1:18080/', OUTLINE_INTERNAL_URL: 'http://127.0.0.1:13000/' })
  assert.equal(new URL(state.databases.OUTLINE_DATABASE).hostname, 'outline-db.example')
  assert.equal(state.environments.server.SERVER_PORT, '18080'); assert.equal(state.environments.outline.PORT, '13000')
  assert.throws(() => composeEnvironment(state), /LOCAL_PROFILE_REQUIRED/)
  assert.throws(() => f.read({ SERVER_PORT: '18080' }), /LISTENER_TARGET_CONFLICT/)
  const local = fixture(t)
  for (const override of [{ SERVER_PORT: '18082' }, { OUTLINE_PORT: '13102' }, { HYDRA_LISTEN_PUBLIC_PORT: '14444' }, { HYDRA_ADMIN_URL: 'http://127.0.0.1:14445/' }])
    assert.throws(() => local.read(override), /LOCAL_LISTENER_CONFLICT/)
})

test('every application listener stays on loopback in local and Nginx deployment profiles', t => {
  for (const profile of ['local', 'deployment']) {
    const f = fixture(t, profile)
    assert.equal(f.read({ SERVER_HOST: '127.0.0.1' }).environments.server.SERVER_HOST, '127.0.0.1')
    for (const key of ['SERVER_HOST', 'OUTLINE_HOST', 'HYDRA_LISTEN_HOST']) for (const host of ['0.0.0.0', '::', 'private.example'])
      assert.throws(() => f.read({ [key]: host }), /PRIVATE_LISTENER_REQUIRED/)
  }
})

test('database URL options and credentials survive explicit conversion, conflicts are key-only and unsupported options stop', t => {
  const password = 'p@:%/# $汉字', url = new URL('postgresql://user:placeholder@db.example:5544/exre')
  url.password = encodeURIComponent(password); url.searchParams.set('sslmode', 'verify-full'); url.searchParams.set('sslrootcert', '/certs/root.pem')
  const original = { DATABASE_URL: url.href, RUNTIME_CONFIG_VERSION: '2', UNKNOWN_SETTING: 'keep' }
  const converted = convertValues(original)
  assert.equal(converted.DATABASE_PASSWORD, password)
  assert.equal(new URL(databaseUrl(converted, 'DATABASE', 'exre')).searchParams.get('sslmode'), 'verify-full')
  assert.equal(converted.UNKNOWN_SETTING, 'keep'); assert.equal(converted.LOCAL_HYDRA_PUBLIC_PORT, '14444')
  assert.equal(converted.DATABASE_URL, undefined)
  assert.throws(() => convertValues({ ...original, DATABASE_PASSWORD: 'conflict-value' }), error => error.message.includes('DATABASE_PASSWORD') && !error.message.includes('conflict-value'))
  assert.throws(() => convertValues({ DATABASE_URL: `${url.href}&application_name=original` }), /CONVERSION_OPTION_UNSUPPORTED/)
})

test('environment serialization preserves literal escape sequences and rejects lossy quoting before writes', async t => {
  const values = { PASSWORD: String.raw`secret\nline\rtail`, UNKNOWN_SETTING: String.raw`a"b\nc` }
  assert.deepEqual({ ...parseEnv(serializeEnvironment(values)) }, values)
  const f = fixture(t), file = join(f.workspace, '.env.local')
  const original = `DATABASE_URL=postgres://user:password@127.0.0.1:5432/exre\nUNKNOWN_SETTING='${String.raw`a"b\nc`}'\n`
  writeFileSync(file, original)
  await convertConfiguration({ workspace: f.workspace, verify: async () => {} })
  assert.equal(parseEnv(readFileSync(file, 'utf8')).UNKNOWN_SETTING, values.UNKNOWN_SETTING)
  assert.throws(() => serializeEnvironment({ PRIVATE: '"\'`' }), /CONVERSION_QUOTING_UNSUPPORTED/)
})

test('conversion verifies original target before writes and preserves exact original backup', async t => {
  const f = fixture(t), old = 'DATABASE_URL="postgres://original:original@127.0.0.1:5432/exre"\nRUNTIME_CONFIG_VERSION=2\n'
  const file = join(f.workspace, '.env.local'); writeFileSync(file, old)
  await assert.rejects(convertConfiguration({ workspace: f.workspace, verify: async () => { throw new Error('offline') } }), /offline/)
  assert.equal(readFileSync(file, 'utf8'), old)
  const result = await convertConfiguration({ workspace: f.workspace, verify: async values => assert.equal(values.DATABASE_URL, 'postgres://original:original@127.0.0.1:5432/exre') })
  assert.equal(readFileSync(result.backup, 'utf8'), old)
  assert.ok(readFileSync(file, 'utf8').includes('DATABASE_PASSWORD="original"'))
})

test('diagnostics distinguish refusal, authentication, database and schema failures; short and encoded secrets are hidden', () => {
  const context = { service: 'Outline', phase: '连接', keys: ['OUTLINE_DATABASE_PASSWORD'], next: '检查连接配置' }
  const messages = ['ECONNREFUSED', '28P01', '3D000', '42P01'].map(code => diagnostic({ code }, context).message)
  assert.equal(new Set(messages).size, 4)
  assert.ok(messages[0].includes('连接被拒绝')); assert.ok(messages[1].includes('密码错误'))
  const password = 'p@%', secret = 'xy'
  const safe = redact(`password=${password} encoded=${encodeURIComponent(password)} raw=${secret} Bearer bearer-value postgres://u:${encodeURIComponent(password)}@host/exre SELECT private FROM private`,
    { DATABASE_PASSWORD: password, OUTLINE_OIDC_CLIENT_SECRET: secret })
  for (const value of [password, encodeURIComponent(password), secret, 'bearer-value', 'postgres://', 'SELECT private']) assert.equal(safe.includes(value), false)
})

test('stage output retains unknown stderr, expands failures and never clears a plain-text terminal', async () => {
  const lines = [], output = reporter({ write: line => lines.push(line), environment: { DATABASE_PASSWORD: 'p@%' } })
  await output.stage('Build', async log => { log('compiler', 'unknown diagnostic', 'stderr'); log('compiler', 'normal output') })
  assert.ok(lines.some(line => line.includes('unknown diagnostic'))); assert.ok(!lines.some(line => line.includes('normal output')))
  await assert.rejects(output.stage('Build', async log => { log('compiler', 'file.ts:22 p@%'); throw new Error() }))
  assert.ok(lines.some(line => line.includes('file.ts:22'))); assert.ok(lines.every(line => !line.includes('p@%') && !line.includes('\x1b')))
})

test('Compose uses only PG18/Redis/Hydra, localhost and correctly encoded DSN; remote targets are refused', t => {
  const f = fixture(t), state = f.read(); state.workspace = root
  const environment = composeEnvironment(state)
  assert.equal(decodeURIComponent(new URL(environment.RUNTIME_HYDRA_DSN).password), f.values.HYDRA_DATABASE_PASSWORD)
  assert.ok(environment.RUNTIME_POSTGRES_IMAGE.includes('postgres:18'))
  assert.throws(() => composeEnvironment({ ...state, databases: { ...state.databases, DATABASE: 'postgres://u:p@foreign:5432/exre' } }), /LAYOUT_CONFLICT/)
})

test('owned stop validates the whole inventory before mutation and refuses unknown or changed resources', async t => {
  const f = fixture(t), state = f.read(); state.workspace = root
  const service = new Services(state), changes = []
  const item = { Id: 'owned', Config: { Labels: { 'com.docker.compose.service': 'redis' } }, Image: 'image', HostConfig: {}, Mounts: [], State: { Running: true } }
  service.inventory = () => [item]
  service.call = args => { changes.push(args); item.State.Running = false; return '' }
  service.file = join(f.workspace, 'dependencies.json')
  writeFileSync(service.file, JSON.stringify({ version: 1, project: 'exwebsite-runtime', proofs: [{ ...service.proof(item), digest: 'changed' }], newlyStarted: ['owned'] }))
  await assert.rejects(service.stop({ lock: false }), /STOP_OWNERSHIP_CONFLICT/); assert.deepEqual(changes, [])
  writeFileSync(service.file, JSON.stringify({ version: 1, project: 'exwebsite-runtime', proofs: [service.proof(item)], newlyStarted: ['owned'] }))
  await service.stop({ lock: false }); assert.deepEqual(changes, [['stop', '--time', '10', 'owned']])
})

test('start cannot replace a saved proof after DNS drift to make a later stop succeed', async t => {
  const state = fixture(t).read(); state.workspace = root
  let duringStart = () => {}, present = true
  const mutations = [], item = { Id: 'a'.repeat(64), Image: 'redis-image-id',
    Config: { Image: 'redis-fixture', Env: [], Labels: {
      'com.docker.compose.service': 'redis', 'com.docker.compose.project': 'exwebsite-runtime',
      'com.docker.compose.oneoff': 'false', 'com.docker.compose.config-hash': 'redis-hash',
      'dev.exwebsite.runtime': 'dependencies',
    } }, HostConfig: { Dns: [], PortBindings: {} }, Mounts: [], State: { Running: false } }
  const services = new Services(state, { run: (_command, args) => {
    let stdout = ''
    if (args[0] === 'ps') stdout = present ? item.Id : ''
    else if (args[0] === 'inspect') stdout = JSON.stringify([item])
    else if (args.includes('config')) stdout = args.includes('--hash') ? 'redis redis-hash'
      : JSON.stringify({ services: { redis: { image: 'redis-fixture' } } })
    else if (args.includes('up') || args[0] === 'stop') {
      mutations.push(args); item.State.Running = args[0] !== 'stop'
      if (args.includes('up')) { present = true; duringStart() }
    }
    return { status: 0, stdout }
  } })
  mkdirSync(state.directory, { recursive: true })
  const saved = JSON.stringify({ version: 1, project: 'exwebsite-runtime', proofs: [services.proof(item)], newlyStarted: [] })
  writeFileSync(services.file, saved)
  item.HostConfig.Dns = ['1.1.1.1']
  await assert.rejects(services.stop({ lock: false }), /STOP_OWNERSHIP_CONFLICT/)
  await assert.rejects(services.start({ selectedServices: ['redis'], assertFree: async () => {}, ready: async () => {},
    log: { title() {}, log() {} } }), /START_OWNERSHIP_CONFLICT/)
  assert.equal(readFileSync(services.file, 'utf8'), saved)
  await assert.rejects(services.stop({ lock: false }), /STOP_OWNERSHIP_CONFLICT/)
  assert.deepEqual(mutations, [])

  item.HostConfig.Dns = []
  const originalItem = structuredClone(item)
  for (const change of [value => { value.HostConfig.Privileged = true }, value => { value.Mounts = [{ Name: 'foreign', Destination: '/extra' }] },
    value => { value.Image = 'replacement-image-id' }, value => { value.Id = 'b'.repeat(64) }]) {
    Object.assign(item, structuredClone(originalItem)); change(item)
    await assert.rejects(services.start({ selectedServices: ['redis'], assertFree: async () => {}, ready: async () => {},
      log: { title() {}, log() {} } }), /START_OWNERSHIP_CONFLICT/)
    assert.equal(readFileSync(services.file, 'utf8'), saved)
  }
  Object.assign(item, structuredClone(originalItem))
  rmSync(services.file)
  await assert.rejects(services.start({ selectedServices: ['redis'], assertFree: async () => {}, ready: async () => {},
    log: { title() {}, log() {} } }), /OWNERSHIP_RECORD_MISSING/)
  for (const record of [null, { ...JSON.parse(saved), version: 2 }, { ...JSON.parse(saved), proofs: [null] }]) {
    const invalid = JSON.stringify(record); writeFileSync(services.file, invalid)
    await assert.rejects(services.start({ selectedServices: ['redis'], assertFree: async () => {}, ready: async () => {},
      log: { title() {}, log() {} } }), /OWNERSHIP_RECORD_INVALID/)
    assert.equal(readFileSync(services.file, 'utf8'), invalid)
  }
  assert.deepEqual(mutations, [])
  writeFileSync(services.file, saved)

  // Legitimate Docker null/[] normalization retains the original proof and permits restart.
  item.HostConfig.Dns = null
  await services.start({ selectedServices: ['redis'], assertFree: async () => {}, ready: async () => {}, log: { title() {}, log() {} } })
  assert.deepEqual(JSON.parse(readFileSync(services.file, 'utf8')).proofs, JSON.parse(saved).proofs)
  await services.stop({ lock: false })
  assert.equal(item.State.Running, false)

  // A change during Compose must not overwrite proof or trigger an unsafe rollback stop.
  const beforeStart = readFileSync(services.file, 'utf8')
  mutations.length = 0
  duringStart = () => { item.HostConfig.Dns = ['9.9.9.9'] }
  await assert.rejects(services.start({ selectedServices: ['redis'], assertFree: async () => {}, ready: async () => {},
    log: { title() {}, log() {} } }), /START_OWNERSHIP_CONFLICT/)
  assert.equal(readFileSync(services.file, 'utf8'), beforeStart)
  assert.equal(mutations.length, 1)
  assert.ok(mutations[0].includes('up'))

  // A genuinely empty inventory still supports first-time creation and a proven stop.
  Object.assign(item, structuredClone(originalItem)); present = false; duringStart = () => {}; rmSync(services.file)
  await services.start({ selectedServices: ['redis'], assertFree: async () => {}, ready: async () => {}, log: { title() {}, log() {} } })
  await services.stop({ lock: false })
  assert.equal(item.State.Running, false)
})

test('owned stop tolerates Docker mount ordering and unset DNS normalization but refuses real resource changes', async t => {
  const state = fixture(t).read(); state.workspace = root
  const services = new Services(state), calls = []
  const item = { Id: 'owned', Config: { Labels: { 'com.docker.compose.service': 'redis' } }, Image: 'image',
    HostConfig: { Dns: null, DnsOptions: null, DnsSearch: null },
    Mounts: [{ Name: 'first', Destination: '/a' }, { Name: 'second', Destination: '/b' }], State: { Running: true } }
  const record = { version: 1, project: 'exwebsite-runtime', proofs: [services.proof(item)], newlyStarted: ['owned'] }
  mkdirSync(state.directory, { recursive: true })
  services.file = join(state.directory, 'dependencies.json'); writeFileSync(services.file, JSON.stringify(record))
  services.inventory = () => [item]
  services.call = args => { calls.push(args); item.State.Running = false; return '' }
  item.Mounts.reverse(); Object.assign(item.HostConfig, { Dns: [], DnsOptions: [], DnsSearch: [] })
  await services.stop({ lock: false })
  assert.deepEqual(calls, [['stop', '--time', '10', 'owned']])
  const valid = structuredClone(item)
  for (const mutation of [value => { value.HostConfig.Dns = ['1.1.1.1'] }, value => { value.Mounts[0].Name = 'foreign' },
    value => { value.Config.Env = ['PASSWORD=changed'] }, value => { value.Image = 'replacement' }]) {
    Object.assign(item, structuredClone(valid)); item.State.Running = true; mutation(item)
    calls.length = 0
    await assert.rejects(services.stop({ lock: false }), /STOP_OWNERSHIP_CONFLICT/)
    assert.deepEqual(calls, [])
  }
})

test('dependency stop refuses an application listener before inspecting or mutating dependencies', async t => {
  const listener = createServer()
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  try {
    const state = fixture(t).read(); state.workspace = root
    state.config = { ...state.config, ports: { ...state.config.ports, public: listener.address().port } }
    const services = new Services(state), calls = []
    services.inventory = () => { calls.push('inventory'); return [] }
    services.call = args => { calls.push(args); return '' }
    await assert.rejects(services.stop(), /APPLICATION_PORT_OCCUPIED/)
    assert.deepEqual(calls, [])
  } finally { await new Promise(resolve => listener.close(resolve)) }
})

test('local service administrator is configurable without changing application database owners', t => {
  const f = fixture(t)
  f.values.POSTGRES_USER = 'existing-admin'; f.save()
  const state = f.read(); state.workspace = root
  const environment = composeEnvironment(state)
  assert.equal(environment.POSTGRES_USER, 'existing-admin')
  assert.equal(state.environments.outline.DATABASE_URL, state.databases.OUTLINE_DATABASE)
  assert.equal(new URL(state.databases.OUTLINE_DATABASE).username, 'outline')
  assert.throws(() => composeEnvironment({ ...state, values: { ...state.values, POSTGRES_VOLUME_EXTERNAL: 'yes' } }), /EXTERNAL_VOLUME_SETTING_INVALID/)
  assert.throws(() => composeEnvironment({ ...state, values: { ...state.values, POSTGRES_VOLUME_NAME: 'shared', REDIS_VOLUME_NAME: 'shared' } }), /LOCAL_SERVICE_CONFIG_INVALID/)
})

test('external PG volume requires a verified project consumer and refuses every foreign running consumer', t => {
  const f = fixture(t)
  Object.assign(f.values, { POSTGRES_VOLUME_NAME: 'preserved-original', POSTGRES_VOLUME_EXTERNAL: 'true' }); f.save()
  const state = f.read(); state.workspace = root
  const services = new Services(state), calls = []
  const owned = { Id: 'owned', Config: { Labels: { 'com.docker.compose.service': 'postgres' } }, Mounts: [{ Type: 'volume', Name: 'preserved-original', Destination: '/var/lib/postgresql' }], State: { Running: false } }
  let items = [], foreignRunning = false
  services.inventory = () => items
  services.verify = value => { assert.equal(value, items); return value }
  services.call = args => {
    calls.push(args)
    if (args[0] === 'volume' && args[1] === 'ls') return 'preserved-original\n'
    if (args[0] === 'volume' && args[1] === 'inspect') return JSON.stringify([{ Name: 'preserved-original', Labels: {} }])
    if (args[0] === 'ps') return 'owned\nforeign\n'
    if (args[0] === 'inspect') return JSON.stringify([owned, { Id: 'foreign', Mounts: owned.Mounts, State: { Running: foreignRunning } }])
    throw new Error('unexpected mutation')
  }
  assert.throws(() => services.verifyVolumes(), /VOLUME_ADOPTION_REQUIRES_MAINTENANCE/)
  items = [owned]; services.verifyVolumes()
  foreignRunning = true
  assert.throws(() => services.verifyVolumes(), /EXTERNAL_VOLUME_IN_USE/)
  foreignRunning = false; owned.Mounts[0].Name = 'different'
  assert.throws(() => services.verifyVolumes(), /VOLUME_ADOPTION_REQUIRES_MAINTENANCE/)
  assert.ok(calls.every(args => ['ps', 'inspect', 'volume'].includes(args[0])))
})

test('document initialization never assigns a configured administrator as a document owner', async t => {
  const f = fixture(t)
  Object.assign(f.values, { POSTGRES_USER: 'existing-admin', OUTLINE_DATABASE_USER: 'existing-admin' }); f.save()
  const queries = []
  await assert.rejects(initializeDocumentDatabases(f.read(), { connect: async () => ({
    query: async sql => { queries.push(sql); return { rows: [] } }, end: async () => {},
  }) }), /DATABASE_OWNER_CONFLICT/)
  assert.deepEqual(queries, [])
})

test('PM2 online with failed health is never success, and rollback preserves a pre-existing process', async t => {
  const f = fixture(t, 'deployment'), state = f.read(), existing = { name: 'exwebsite-server', pm_id: 7, pid: 70, pm2_env: { status: 'online' } }
  for (const path of ['apps/server/dist', 'apps/outline/build/server']) mkdirSync(join(f.workspace, path), { recursive: true })
  writeFileSync(join(f.workspace, 'apps/server/dist/server.js'), ''); writeFileSync(join(f.workspace, 'apps/outline/build/server/index.js'), '')
  writeFileSync(state.values.HYDRA_BINARY, '')
  const native = new NativeApplications(state, { preflight: async () => {}, client: async () => {}, health: async () => { throw new Error('health failed') } }), calls = []
  let items = [existing]
  native.inventory = () => items
  native.call = args => { calls.push(args); if (args[0] === 'start') items = [...items, ...[{ name: 'exwebsite-outline', pm_id: 8 }, { name: 'exwebsite-hydra', pm_id: 9 }].filter(item => args.at(-1).split(',').includes(item.name))] }
  await assert.rejects(native.start({ verifySchemas: async () => {}, acquire: () => ({ release() {} }), verifyBinary: () => {} }), /health failed/)
  assert.deepEqual(calls.at(-1), ['delete', '9', '8'])
  assert.equal(calls.some(args => args.includes('all') || args.includes('7')), false)
})

test('identity conflicts fail before PM2 starts and Hydra client checks precede starting Website or Outline', async t => {
  const state = fixture(t, 'deployment').read(), calls = []
  const native = new NativeApplications(state, { preflight: async () => { throw new Error('old issuer') } })
  native.inventory = () => []; native.call = args => calls.push(args)
  await assert.rejects(native.start({ verifySchemas: async () => {}, acquire: () => ({ release() {} }) }), /old issuer/)
  assert.deepEqual(calls, [])
})

test('PM2 wrapper uses the same supported process overrides and isolated PM2 home as the invoking command', t => {
  const f = fixture(t, 'deployment'), environment = { DATABASE_PASSWORD: 'process secret', PM2_HOME: join(f.workspace, 'isolated-pm2') }
  const state = f.read(environment)
  writeFileSync(state.values.HYDRA_BINARY, '')
  const native = new NativeApplications(state, { run: (command, args, options) => {
    const plan = JSON.parse(options.env.EXWEBSITE_RUNTIME_LAUNCH_PLAN)
    assert.equal(plan.server.specification.environment.DATABASE_URL, state.databases.DATABASE)
    assert.equal(plan.hydra.specification.environment.AUTH_CODE_HMAC_KEY, undefined)
    assert.equal(plan.outline.specification.environment.AUTH_CODE_HMAC_KEY, undefined)
    assert.equal(options.env.PM2_HOME, environment.PM2_HOME)
    return { status: 0, stdout: '[]' }
  } })
  native.call(['start', native.ecosystem])
  assert.equal(processRecord(state, 'hydra').specification.environment.OUTLINE_OIDC_CLIENT_SECRET, undefined)
})

test('native stop remains available when the Hydra binary is missing and only deletes exact project IDs', async t => {
  const state = fixture(t, 'deployment').read(), calls = []
  let items = [{ name: 'exwebsite-hydra', pm_id: 7, pid: 70, pm2_env: { pm_exec_path: join(state.workspace, 'scripts/runtime/pm2-process.mjs'), pm_cwd: state.workspace, args: ['hydra'] } }]
  const native = new NativeApplications(state, { run: (command, args, options) => {
    calls.push(args); assert.equal(options.env.EXWEBSITE_RUNTIME_LAUNCH_PLAN, undefined)
    if (args[0] === 'delete') items = []
    return { status: 0, stdout: JSON.stringify(items) }
  } })
  await native.stop()
  assert.deepEqual(calls, [['jlist'], ['delete', '7'], ['jlist']])
})

test('conversion checks all three original databases, issuer and old pending target availability before writing', async t => {
  const values = fixture(t).values, seen = [], queries = []
  const connect = async url => {
    const name = new URL(url).pathname.slice(1), owner = values[`${name === 'exre' ? 'DATABASE' : name.toUpperCase() + '_DATABASE'}_USER`]
    seen.push(name)
    return { query: async sql => { queries.push(sql); return { rows: sql.includes('current_database') ? [{ name, owner }] :
      sql.includes('pg_database') ? [{ owner }] : sql.includes('to_regclass') ? [{ name: 'present' }] :
      sql.includes('SELECT issuer') ? [{ issuer: 'http://127.0.0.1:4444/' }] : sql.includes('target_bindings') ? [{ target_bindings: JSON.stringify([{ clientId: 'ex-outline-local', hydraSid: 'old' }]) }] : [] } }, end: async () => {} }
  }
  let checkedClient = false
  await verifyOriginalTargets(values, values, { connect, verifyClient: async () => { checkedClient = true } })
  assert.deepEqual(seen, ['exre', 'outline', 'hydra']); assert.equal(checkedClient, true)
  assert.ok(queries.every(sql => /^(SELECT|BEGIN READ ONLY|ROLLBACK)/.test(sql)))
  await assert.rejects(verifyOriginalTargets(values, { ...values, HYDRA_PUBLIC_URL: 'http://127.0.0.1:14444/' }, { connect, verifyClient: async () => {} }), /CONVERSION_ISSUER_CONFLICT/)
  const unavailable = async url => {
    const client = await connect(url), original = client.query
    client.query = async sql => sql.includes('target_bindings') ? { rows: [{ target_bindings: JSON.stringify([{ clientId: 'ex-outline', hydraSid: 'legacy' }]) }] } : original(sql)
    return client
  }
  await assert.rejects(verifyOriginalTargets(values, values, { connect: unavailable, verifyClient: async () => {} }), /CONVERSION_OLD_IDENTITY_PENDING/)
})

test('compiled production entries use no tsx, no migration and include all Outline services', t => {
  const state = fixture(t, 'deployment').read()
  for (const service of ['server', 'outline']) assert.equal(processSpecification(state, service).args.includes('tsx'), false)
  const outline = processSpecification(state, 'outline')
  assert.ok(outline.args.includes('--no-migrate')); assert.ok(outline.args.some(value => value.includes('worker') && value.includes('collaboration')))
})

test('offline Build excludes runtime secrets, needs no prepared database, and stops at the first failed stage', async t => {
  const f = fixture(t), corepack = join(f.workspace, 'corepack.js'); writeFileSync(corepack, '')
  const specs = buildSpecifications({ workspace: f.workspace, inherited: { INTEGRATION_COREPACK_JS: corepack, DATABASE_URL: 'private', AUTH_CODE_HMAC_KEY: 'private' } })
  assert.equal(specs.length, 7)
  assert.ok(specs.every(spec => spec.environment.DATABASE_URL === undefined && spec.environment.AUTH_CODE_HMAC_KEY === undefined && spec.environment.NODE_ENV === 'production'))
  const executed = []
  await assert.rejects(build({ workspace: f.workspace, inherited: { INTEGRATION_COREPACK_JS: corepack } }, async spec => {
    executed.push(spec.name); if (executed.length === 2) throw new Error('compiler failure')
  }), /RUNTIME_BUILD_FAILED:@workspace\/web/)
  assert.equal(executed.length, 2)
})

test('retired mode flags cannot bypass the root server configuration', t => {
  const f = fixture(t)
  for (const mode of ['local', 'dev', 'full']) {
    const spec = serverSpecification('dev', [], { workspace: f.workspace,
      inherited: { WEBSITE_INTEGRATION_ENABLED: 'true', WEBSITE_INTEGRATION_MODE: mode } })
    assert.equal(spec.environment.DATABASE_URL, f.read().environments.server.DATABASE_URL)
    assert.equal(spec.environment.RUNTIME_ENV_INJECTED, 'true')
  }
})

test('production maintenance uses compiled CLI and native Hydra must match the locked version', t => {
  const f = fixture(t, 'deployment'), state = f.read()
  const spec = serverSpecification('db:migrate', [], { workspace: f.workspace, inherited: { NODE_ENV: 'production' } })
  assert.deepEqual(spec.args, ['dist/db/migrate.js'])
  writeFileSync(state.values.HYDRA_BINARY, '')
  verifyHydraBinary(state, () => ({ status: 0, stdout: 'Version: v2.3.0\n' }))
  for (const result of [{ status: 1 }, { status: 0, stdout: 'Version: v2.2.0' }, { status: 0, stdout: 'Version: v2.3.0-dev' }])
    assert.throws(() => verifyHydraBinary(state, () => result), /HYDRA_VERSION_CONFLICT/)
})

test('Nginx template preserves same-origin mounts, HTTPS, WebSocket and denied internal paths; injection fails', t => {
  const f = fixture(t, 'deployment'), state = f.read(); state.workspace = root
  Object.assign(state.values, { NGINX_SITE_CERT: '/certs/site.crt', NGINX_SITE_KEY: '/certs/site.key', NGINX_ISSUER_CERT: '/certs/issuer.crt',
    NGINX_ISSUER_KEY: '/certs/issuer.key', HYDRA_INTERNAL_PUBLIC_URL: 'http://127.0.0.1:4444' })
  const text = nginxConfiguration(state)
  for (const fragment of ['X-Forwarded-Prefix /docs', 'X-Forwarded-Proto https', 'proxy_set_header Upgrade', 'internal(?:/|$)', 'oauth2/', 'try_files']) assert.ok(text.includes(fragment))
  assert.equal(text.includes('@@'), false)
  state.values.NGINX_SITE_KEY = '/bad;injected'; assert.throws(() => nginxConfiguration(state), /NGINX_VALUE_INVALID/)
})

test('Nginx API upload ceiling covers the complete join and configured storage wire budgets', t => {
  const state = fixture(t, 'deployment').read(); state.workspace = root
  Object.assign(state.values, { NGINX_SITE_CERT: '/certs/site.crt', NGINX_SITE_KEY: '/certs/site.key',
    NGINX_ISSUER_CERT: '/certs/issuer.crt', NGINX_ISSUER_KEY: '/certs/issuer.key', HYDRA_INTERNAL_PUBLIC_URL: 'http://127.0.0.1:4444' })
  assert.match(nginxConfiguration(state), /location \/api\/ \{\s*client_max_body_size 67108864;/)
  state.values.STORAGE_MAX_BYTES = String(80 * 1024 * 1024)
  assert.match(nginxConfiguration(state), /client_max_body_size 83951616;/)
  for (const value of ['0', '-1', 'NaN', '1.5', '1e3', ' 20 ', String(Number.MAX_SAFE_INTEGER)]) {
    state.values.STORAGE_MAX_BYTES = value
    assert.throws(() => nginxConfiguration(state), /NGINX_UPLOAD_BUDGET_INVALID/)
  }
})

test('structured logs stay bounded and redact short secrets before writing any retained file', t => {
  const f = fixture(t), file = join(f.workspace, 'logs/app.jsonl')
  const log = logWriter(file, { maxBytes: 1024, retain: 2, environment: { DATABASE_PASSWORD: 'p@%' } })
  for (let index = 0; index < 30; index++) log('app', `p@% ${'\u0000汉'.repeat(200)}`)
  const files = readdirSync(join(f.workspace, 'logs'))
  assert.ok(files.length <= 3)
  for (const name of files) {
    assert.equal(readFileSync(join(f.workspace, 'logs', name), 'utf8').includes('p@%'), false)
    assert.ok(statSync(join(f.workspace, 'logs', name)).size <= 1024)
  }
})

test('new parser separates dependency and native commands and rejects unknown/repeated flags', () => {
  assert.deepEqual(parseRuntimeArguments(['service:logs', 'redis']), { command: 'service:logs', service: 'redis', verbose: false })
  for (const args of [['service:start', '--mode', 'local'], ['infra', 'configure'], ['infra', 'bootstrap'], ['dev', '--verbose', '--verbose'], ['stop', 'all']]) assert.throws(() => parseRuntimeArguments(args))
})

test('unified tests exclude real lifecycle probes and remove development credentials from every group', async () => {
  const specs = testSpecifications({ workspace: root, inherited: { DATABASE_URL: 'developer-private', REDIS_URL: 'developer-redis' } })
  assert.ok(specs.length > 3); assert.ok(specs.every(spec => !Object.values(spec.environment).includes('developer-private')))
  assert.ok(specs[1].args.every(value => !value.endsWith('-real.test.mjs')))
  const executed = []
  await assert.rejects(runTests({ workspace: root }, async spec => { executed.push(spec.name); if (executed.length === 2) throw new Error('group failed') }), /group failed/)
  assert.deepEqual(executed, ['Website', 'runtime / Docs 脚本'])
})
