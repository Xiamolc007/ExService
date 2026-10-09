import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer as httpServer } from 'node:http'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID, randomBytes } from 'node:crypto'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { runMigrations } from '../../apps/server/dist/db/migration-runner.js'
import { openDatabase } from '../../apps/server/dist/db/client.js'
import { root } from './configure.mjs'
import { configureLocal, defaults, otherOutboxTargets } from './local-config.mjs'
import { legacyRuntimeServices } from './legacy.mjs'
import { docker } from './foundation.mjs'
import { redact } from './ownership.mjs'

async function unusedPort() { const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
async function endpoint(calls, kind) {
  const server = httpServer((request, response) => {
    let body = ''; request.on('data', chunk => { body += chunk }); request.on('end', () => {
      calls.push({ kind, method: request.method, path: request.url, key: request.headers['x-identity-delivery-key'], body: body ? JSON.parse(body) : undefined })
      response.writeHead(kind.includes('hydra') ? 204 : 200); response.end()
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { port: server.address().port, close: () => new Promise(resolve => server.close(resolve)) }
}
test('actual Website container sends qualified old-local cleanup through host-gateway with original key and keeps offline rows pending', { timeout: 180000 }, async () => {
  const workspace = mkdtempSync(join(root, '.local/docs-integration/outbox-network-')), directory = join(workspace, '.local/docs-integration/local-dev')
  const calls = [], servers = [], containerNames = []
  let container, db
  try {
    const localHydra = await endpoint(calls, 'local-hydra'), localOutline = await endpoint(calls, 'local-outline')
    const currentHydra = await endpoint(calls, 'current-hydra'), currentOutline = await endpoint(calls, 'current-outline')
    servers.push(localHydra, localOutline, currentHydra, currentOutline)
    container = await new PostgreSqlContainer('postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea').withDatabase('exre').start()
    const database = new URL(container.getConnectionUri()); if (database.hostname === 'localhost') database.hostname = '127.0.0.1'
    await runMigrations({ connectionString: database.href }); db = await openDatabase({ connectionString: database.href })
    const ports = {}, used = new Set([localHydra.port, localOutline.port, currentHydra.port, currentOutline.port])
    for (const name of Object.keys(defaults)) { do { ports[name] = await unusedPort() } while (used.has(ports[name])); used.add(ports[name]) }
    ports.hydraAdmin = localHydra.port; ports.outline = localOutline.port
    const source = await configureLocal({ workspace, directory, ports, validateTools() {}, inherited: { DATABASE_URL: database.href, AUTH_CODE_HMAC_KEY: randomBytes(32).toString('hex') } })
    const targets = otherOutboxTargets('full', workspace, {}), originalKey = source.secrets.IDENTITY_DELIVERY_KEY, currentKey = randomBytes(32).toString('hex')
    const services = legacyRuntimeServices('full', { recipePath: '.local/docs-integration/Dockerfile.website-runtime', targets })
    assert.deepEqual(services.server.extra_hosts, { 'host.docker.internal': 'host-gateway' })
    const containerDatabase = new URL(database.href); containerDatabase.hostname = 'host.docker.internal'
    const environment = { ...process.env, DATABASE_URL: containerDatabase.href, WEBSITE_INTEGRATION_ENABLED: 'true', WEBSITE_INTEGRATION_MODE: 'full',
      HYDRA_ADMIN_URL: `http://host.docker.internal:${currentHydra.port}/`, OUTLINE_INTERNAL_URL: `http://host.docker.internal:${currentOutline.port}/`,
      OUTLINE_INTEGRATION_KEY: randomBytes(32).toString('hex'), IDENTITY_BOOTSTRAP_KEY: randomBytes(32).toString('hex'),
      IDENTITY_FLOW_KEY: randomBytes(32).toString('hex'), IDENTITY_DELIVERY_KEY: currentKey, IDENTITY_OUTBOX_TARGETS_JSON: targets }
    const userId = randomUUID(), sessionId = randomUUID()
    await db.query("INSERT INTO auth_users(id,email,nickname,password_hash,created_at) VALUES($1,$2,'Fixture','fixture',0)", [userId, `${userId}@example.test`])
    await db.query('INSERT INTO auth_sessions(token_hash,id,user_id,created_at,expires_at) VALUES($1,$2,$3,0,9999999999999)', [randomBytes(32).toString('hex'), sessionId, userId])
    const event = async targets => {
      const eventId = randomUUID()
      await db.query("INSERT INTO auth_identity_outbox(event_id,kind,session_id,user_id,target_bindings,created_at,next_attempt_at,delivered_targets) VALUES($1,'session',$2,$3,$4,0,0,'[]')", [eventId, sessionId, userId, JSON.stringify(targets)])
      return eventId
    }
    const drain = async () => {
      const name = `exwebsite-outbox-test-${randomUUID()}`; containerNames.push(name)
      const args = ['run', '--rm', '--name', name, '--add-host', 'host.docker.internal:host-gateway', '--workdir', '/workspace/website/apps/server',
        '-v', `${join(root, 'apps/server/dist')}:/workspace/website/apps/server/dist:ro`, '-v', `${join(root, 'scripts/docs-integration/outbox-network-fixture.mjs')}:/workspace/website/apps/server/outbox-network-fixture.mjs:ro`,
        ...['DATABASE_URL', 'WEBSITE_INTEGRATION_ENABLED', 'WEBSITE_INTEGRATION_MODE', 'HYDRA_ADMIN_URL', 'OUTLINE_INTERNAL_URL', 'OUTLINE_INTEGRATION_KEY',
          'IDENTITY_BOOTSTRAP_KEY', 'IDENTITY_FLOW_KEY', 'IDENTITY_DELIVERY_KEY', 'IDENTITY_OUTBOX_TARGETS_JSON'].flatMap(key => ['-e', key]),
        'exwebsite-local-task3-build-proof', 'node', 'outbox-network-fixture.mjs']
      const child = spawn('docker', args, { env: environment, shell: false, windowsHide: true }), result = { stdout: '', stderr: '' }
      child.stdout.on('data', chunk => { result.stdout += chunk }); child.stderr.on('data', chunk => { result.stderr += chunk })
      result.status = await new Promise(resolve => child.once('close', resolve))
      assert.equal(result.status, 0, redact(result.stdout + result.stderr, environment))
      return JSON.parse(result.stdout.trim())
    }
    const sid = `shared-${randomUUID()}`, first = await event([{ clientId: 'ex-outline-local', hydraSid: sid }, { clientId: 'ex-outline', hydraSid: sid }])
    assert.deepEqual((await drain()).authorizationClients, ['ex-outline', 'ex-oidc-probe'])
    const firstRow = (await db.query('SELECT completed_at,delivered_targets FROM auth_identity_outbox WHERE event_id=$1', [first])).rows[0]
    assert.equal(firstRow.completed_at, 1000)
    assert.deepEqual(JSON.parse(firstRow.delivered_targets), [`hydra:ex-outline-local:${sid}`, `outline:ex-outline-local:${sid}`, `hydra:ex-outline:${sid}`, `outline:ex-outline:${sid}`])
    assert.deepEqual(calls.map(call => call.kind), ['local-hydra', 'local-outline', 'current-hydra', 'current-outline'])
    assert.equal(calls[0].path, `/admin/oauth2/auth/sessions/login?sid=${sid}`)
    assert.equal(calls[1].key, originalKey); assert.notEqual(originalKey, currentKey)
    assert.deepEqual(calls[1].body, { eventId: first, sessionId })
    assert.equal(calls[3].key, currentKey)
    await localOutline.close()
    const secondSid = `offline-outline-${randomUUID()}`, second = await event([{ clientId: 'ex-outline-local', hydraSid: secondSid }])
    assert.deepEqual((await drain()).errors, ['IDENTITY_OUTBOX_DELIVERY_PENDING'])
    const secondRow = (await db.query('SELECT completed_at,attempts,delivered_targets FROM auth_identity_outbox WHERE event_id=$1', [second])).rows[0]
    assert.equal(secondRow.completed_at, null); assert.equal(secondRow.attempts, 1)
    assert.deepEqual(JSON.parse(secondRow.delivered_targets), [`hydra:ex-outline-local:${secondSid}`])
    await localHydra.close()
    const third = await event([{ clientId: 'ex-outline-local', hydraSid: `offline-hydra-${randomUUID()}` }])
    assert.deepEqual((await drain()).errors, ['IDENTITY_OUTBOX_HYDRA_PENDING'])
    const thirdRow = (await db.query('SELECT completed_at,attempts,delivered_targets FROM auth_identity_outbox WHERE event_id=$1', [third])).rows[0]
    assert.equal(thirdRow.completed_at, null); assert.equal(thirdRow.attempts, 1); assert.deepEqual(JSON.parse(thirdRow.delivered_targets), [])
    assert.equal(calls.filter(call => call.kind === 'current-hydra').length, 1)
    console.log(JSON.stringify({ actualWebsiteContainer: true, hostGatewayTransport: true, originalKeyPreserved: true, sameSidQualifiedByClient: true,
      correctOldAndCurrentHydra: true, outlineOfflinePending: true, hydraOfflinePending: true, temporaryContainerNames: containerNames }))
  } finally {
    for (const server of servers) await server.close()
    for (const name of containerNames) assert.notEqual(docker(['inspect', name], { allowFailure: true }).status, 0)
    await db?.close(); await container?.stop(); rmSync(workspace, { recursive: true, force: true })
  }
})
