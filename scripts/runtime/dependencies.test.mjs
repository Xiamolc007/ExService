import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { startDependencies, stopDependencies } from './dependencies.mjs'
import { LocalError } from '../docs-integration/local-config.mjs'
import { supervise } from '../docs-integration/local-dev.mjs'

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'exwebsite-dependencies-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const calls = [], state = { directory, workspace: directory, fingerprint: 'stable' }
  const foundation = { started: new Map(), preRunning: new Map([['original', { id: 'original', service: 'postgres' }]]),
    preflight() { calls.push('preflight') }, verifyVolumes: () => ['volume-proof'], snapshot() { return { started: [...this.started.values()], preRunning: [...this.preRunning.values()], containerProofs: [] } },
    async start(services, options) { calls.push(services); this.started.set('new', { id: 'new', service: 'hydra' }); options.onChange(); },
    async stopStarted() { calls.push(['stop', ...this.started.keys()]) }, verifyStopped() { calls.push('verify-stopped') },
    restore() { calls.push('restore') } }
  const acquire = () => ({ record: { runId: 'run-id', identity: {} }, update() {}, release() { calls.push('release') } })
  return { state, foundation, acquire, calls, validate() {}, prepared: () => ({ volumes: ['volume-proof'] }), ready: async () => {} }
}
test('start only starts PG Redis Hydra and releases the mutex after verified readiness', async t => {
  const f = fixture(t); await startDependencies(f.state, f)
  assert.deepEqual(f.calls, ['preflight', ['postgres', 'redis', 'hydra'], 'release'])
  assert.equal(JSON.parse(readFileSync(join(f.state.directory, 'dependencies.json'))).state, 'dependencies-ready')
})
test('failed readiness stops only newly started IDs and retains an explicit cleanup receipt', async t => {
  const f = fixture(t); f.ready = async () => { throw new Error('not ready') }
  await assert.rejects(startDependencies(f.state, f), /not ready/)
  assert.ok(f.calls.some(value => Array.isArray(value) && value[0] === 'stop' && value.join(',') === 'stop,new'))
  assert.equal(f.calls.includes('release'), false)
  assert.equal(JSON.parse(readFileSync(join(f.state.directory, 'dependencies.json'))).cleanupRequired, true)
  await assert.rejects(startDependencies(f.state, f), /DEPENDENCY_CLEANUP_REQUIRED/)
})
test('stop refuses live applications before dependency mutation', async t => {
  const f = fixture(t); f.acquire = () => { throw new LocalError('MODE_ACTIVE') }
  await assert.rejects(stopDependencies(f.state, f), /APPLICATIONS_ACTIVE/); assert.deepEqual(f.calls, [])
})
test('stop includes all historically owned dependencies and retains volumes', async t => {
  const f = fixture(t); f.recovery = () => ({ resources: {} })
  await stopDependencies(f.state, f)
  assert.deepEqual(f.calls, ['restore', ['stop', 'original'], 'verify-stopped', 'release'])
  assert.equal(JSON.parse(readFileSync(join(f.state.directory, 'dependencies.json'))).state, 'stopped')
})
test('unknown dependency proof fails before any stop', async t => {
  const f = fixture(t); f.recovery = () => ({ resources: {} }); f.foundation.restore = () => { throw new LocalError('FOUNDATION_OWNER_UNKNOWN') }
  await assert.rejects(stopDependencies(f.state, f), /FOUNDATION_OWNER_UNKNOWN/)
  assert.equal(f.calls.some(Array.isArray), false)
})
test('independent dev interruption cleans owned applications and releases its lock without stopping Docker', async t => {
  const f = fixture(t), stopped = []
  await supervise({ mode: 'local', fingerprint: f.state.fingerprint, directory: f.state.directory, lock: f.acquire(), specifications: [{ name: 'web' }],
    spawnChild: async specification => ({ specification, identity: {}, exited: new Promise(() => {}) }),
    stopChildren: async children => { stopped.push(...children.map(child => child.specification.name)) },
    readiness: async () => { process.emit('SIGINT') }, pollInterval: 1, onLog() {} })
  assert.deepEqual(stopped, ['web']); assert.equal(f.calls.some(Array.isArray), false)
})
