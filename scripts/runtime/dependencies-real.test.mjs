import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { root } from '../docs-integration/configure.mjs'
import { secretNames, atomicJson, digest } from '../docs-integration/local-config.mjs'
import { acquireLock } from '../docs-integration/ownership.mjs'
import { Foundation } from '../docs-integration/foundation.mjs'
import { initializeLocal, localOwnershipCheck } from '../docs-integration/local-dev.mjs'
import { readRuntimeConfiguration, portKeys, operatingEnvironment } from './configuration.mjs'
import { receiptFor, serializeEnvironment } from './configure.mjs'
import { startDependencies, stopDependencies } from './dependencies.mjs'

test('isolated runtime repeatedly starts/stops prepared dependencies and preserves PostgreSQL/Redis data', {
  skip: process.env.RUN_COMMAND_RUNTIME_REAL !== '1', timeout: 360000,
}, async t => {
  const temporary = mkdtempSync(join(tmpdir(), 'exwebsite-runtime-real-')), project = `exwebsite-local-test-${randomUUID().slice(0, 8)}`
  const ports = {}, reservations = []
  for (const name of Object.keys(portKeys)) {
    const server = createServer(); await new Promise(done => server.listen(0, '127.0.0.1', done))
    ports[portKeys[name]] = String(server.address().port); reservations.push(server)
  }
  await Promise.all(reservations.map(server => new Promise(done => server.close(done))))
  const values = { RUNTIME_CONFIG_VERSION: '2', RUNTIME_PROFILE: 'local', DATABASE_URL: 'postgres://fixture:fixture@127.0.0.1:1/exre',
    AUTH_CODE_HMAC_KEY: randomBytes(32).toString('hex'), ...ports,
    ...Object.fromEntries(secretNames.map(key => [key, randomBytes(32).toString('hex')])) }
  writeFileSync(join(temporary, '.env.local'), serializeEnvironment(values))
  const state = readRuntimeConfiguration({ workspace: temporary, inherited: operatingEnvironment() }); state.workspace = root
  const create = () => new Foundation(state, { project, environment: state.environments.compose })
  const genesis = create(), mutex = join(temporary, 'mutex')
  t.after(() => {
    assert.match(project, /^exwebsite-local-test-[0-9a-f]{8}$/)
    // Harness-only cleanup of this new disposable project; root stop never deletes volumes.
    genesis.preflight(false); genesis.compose(['down', '--volumes'])
    rmSync(temporary, { recursive: true, force: true })
  })
  atomicJson(join(state.directory, 'config.json'), receiptFor(state))
  await initializeLocal(state, { foundation: genesis, directory: mutex, externalCheck: () => {} })
  const options = foundation => ({ foundation, acquire: parameters => acquireLock({ ...parameters, directory: mutex,
    externalCheck: localOwnershipCheck(state, foundation, { externalCheck: () => {} }) }) })
  await startDependencies(state, options(create()))
  const active = create(); active.preflight(true)
  const originalVolumes = active.verifyVolumes()
  assert.deepEqual(active.containers().filter(item => item.State.Running).map(item => item.Config.Labels['com.docker.compose.service']).sort(), ['hydra', 'postgres', 'redis'])
  active.compose(['exec', '-T', 'postgres', 'psql', '-U', 'outline', '-d', 'outline', '-c', "CREATE TABLE runtime_sentinel (value text); INSERT INTO runtime_sentinel VALUES ('preserved');"])
  active.compose(['exec', '-T', 'redis', 'redis-cli', 'SET', 'runtime_sentinel', 'preserved'])
  await startDependencies(state, options(create()))
  const application = acquireLock({ mode: 'local', fingerprint: state.fingerprint, directory: mutex, externalCheck: () => {} })
  await assert.rejects(stopDependencies(state, options(create())), /APPLICATIONS_ACTIVE/)
  application.release()
  await stopDependencies(state, options(create()))
  assert.equal(create().containers().every(item => item.State.Running === false), true)
  assert.equal(digest(create().verifyVolumes()), digest(originalVolumes))
  await stopDependencies(state, options(create()))
  await startDependencies(state, options(create()))
  assert.match(create().compose(['exec', '-T', 'postgres', 'psql', '-U', 'outline', '-d', 'outline', '-Atc', 'SELECT value FROM runtime_sentinel']).stdout, /preserved/)
  assert.equal(create().compose(['exec', '-T', 'redis', 'redis-cli', 'GET', 'runtime_sentinel']).stdout.trim(), 'preserved')
  await stopDependencies(state, options(create()))
})
