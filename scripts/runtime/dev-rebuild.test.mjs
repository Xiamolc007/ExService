import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { atomicJson, readJson } from './local-config.mjs'
import { supervise } from './local-dev.mjs'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
async function waitFor(predicate) { for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(5) }; throw new Error('fixture timed out') }
function fixture(t, extra = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'sdk-rebuild-')), events = [], children = [], ready = []
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const lock = { record: { runId: 'fixture', identity: { pid: process.pid } }, update(value) { Object.assign(this.record, value) }, release() { events.push('release') } }
  let changed
  const options = { directory, lock, mode: 'local', fingerprint: 'fixture', pollInterval: 5,
    specifications: [{ name: 'server' }], onLog() {},
    watchSources(onChange) { changed = onChange; return { close() { events.push('watch-close') } } },
    async spawnChild(specification) {
      const done = deferred(), child = { specification, identity: { pid: children.length + 1 }, child: { exitCode: null, signalCode: null }, exited: done.promise,
        finish(code = 0) { this.child.exitCode = code; done.resolve({ code }) } }
      events.push(`spawn:${specification.name}`); children.push(child); return child
    },
    async stopChildren(items) { for (const child of items) { events.push(`stop:${child.specification.name}`); child.finish() } },
    async prepareGeneration() { events.push('prepare') }, async preflight() { events.push('preflight') },
    async readiness(_children, { generation }) { events.push(`check:${generation}`) }, onReady() { ready.push(snapshot().generation) }, ...extra }
  const snapshot = () => readJson(join(directory, 'run.json'))
  const stop = () => atomicJson(join(directory, 'control-request.json'), { runId: 'fixture', action: 'stop' })
  return { options, events, children, ready, snapshot, stop, change: () => changed(), lock }
}

test('initial preparation is persisted under the lock, its owned child drains before preflight and application launch', async t => {
  const gate = deferred(); let f
  f = fixture(t, { async prepareGeneration({ execute, signal }) {
    assert.equal(f.snapshot().state, 'preparing'); assert.equal(signal.aborted, false)
    await execute({ name: 'SDK build' }); await gate.promise
  } })
  const running = supervise(f.options)
  await waitFor(() => f.children.length === 1)
  assert.equal(f.snapshot().children[0].name, 'SDK build')
  f.children[0].finish(); await waitFor(() => f.events.includes('stop:SDK build'))
  assert.deepEqual(f.snapshot().children, []); gate.resolve()
  await waitFor(() => f.ready.length === 1)
  assert.deepEqual(f.events.slice(0, 4), ['spawn:SDK build', 'stop:SDK build', 'preflight', 'spawn:server'])
  f.stop(); await running
  assert.equal(f.events.includes('watch-close'), true)
})

test('changes stop applications before serial preparation and never launch intermediate pending products', async t => {
  const gate = deferred(); let count = 0
  const f = fixture(t, { async prepareGeneration() { count++; f.events.push(`prepare:${count}`); if (count === 2) await gate.promise } })
  const running = supervise(f.options)
  await waitFor(() => f.ready.length === 1); f.change()
  await waitFor(() => count === 2); assert.equal(f.children[0].child.exitCode, 0)
  f.change(); f.change(); gate.resolve()
  await waitFor(() => f.ready.length === 2)
  assert.equal(count, 3); assert.equal(f.children.length, 2)
  assert.ok(f.events.indexOf('stop:server') < f.events.indexOf('prepare:2'))
  f.stop(); await running
})

test('rebuild failure waits for a real change without using old dist, then recovers', async t => {
  let count = 0
  const f = fixture(t, { async prepareGeneration() { if (++count === 2) throw new Error('compile failed') } })
  const running = supervise(f.options)
  await waitFor(() => f.ready.length === 1); f.change()
  await waitFor(() => f.snapshot().state === 'rebuild-failed'); await delay(30)
  assert.equal(count, 2); assert.equal(f.children.length, 1); assert.equal(f.children[0].child.exitCode, 0)
  f.change(); await waitFor(() => f.ready.length === 2)
  f.stop(); await running
})

test('old readiness cannot declare a newer generation ready', async t => {
  const old = deferred(); let checks = 0
  const f = fixture(t, { async readiness() { if (++checks === 1) await old.promise } })
  const running = supervise(f.options)
  await waitFor(() => checks === 1); f.change()
  await waitFor(() => f.ready.length === 1); old.resolve(); await delay(15)
  assert.equal(checks, 2); assert.equal(f.ready.length, 1); assert.equal(f.children.length, 2)
  f.stop(); await running
})

for (const phase of ['prepare', 'readiness']) test(`control stop interrupts ${phase} and drains exact owned children`, async t => {
  let entered = false
  const f = fixture(t, phase === 'prepare' ? { async prepareGeneration({ execute }) { entered = true; await execute({ name: 'SDK build' }) } }
    : { async readiness() { entered = true; await new Promise(() => {}) } })
  const running = supervise(f.options)
  await waitFor(() => entered && f.children.length === 1); f.stop(); await running
  assert.equal(f.children[0].child.exitCode, 0); assert.equal(f.ready.length, 0)
  assert.equal(f.events.includes('watch-close'), true); assert.equal(f.events.at(-1), 'release')
})

test('preparation cleanup failure retains preparer proof and lock instead of starting applications', async t => {
  const f = fixture(t, { async prepareGeneration({ execute }) { await execute({ name: 'SDK build' }) },
    async stopChildren(items) { if (items.length) throw new Error('cleanup failure') } })
  const running = supervise(f.options)
  await waitFor(() => f.children.length === 1); f.children[0].finish()
  await assert.rejects(running, /cleanup failure/)
  assert.equal(f.lock.record.cleanupRequired, true); assert.equal(f.snapshot().state, 'cleanup-failed')
  assert.equal(f.snapshot().children[0].name, 'SDK build'); assert.equal(f.events.includes('release'), false)
})

test('initial preparation or preflight failure closes watchers without ever starting an application', async t => {
  for (const phase of ['prepareGeneration', 'preflight']) {
    const f = fixture(t, { async [phase]() { throw new Error('initial failure') } })
    await assert.rejects(supervise(f.options), /initial failure/)
    assert.equal(f.children.length, 0); assert.equal(f.snapshot().state, 'stopped')
    assert.equal(f.events.includes('watch-close'), true); assert.equal(f.events.at(-1), 'release')
  }
})

test('watcher cleanup failure still stops applications and retains cleanup ownership', async t => {
  const f = fixture(t, { watchSources() { return { close() { throw new Error('watch close failed') } } } })
  const running = supervise(f.options)
  await waitFor(() => f.ready.length === 1); f.stop()
  await assert.rejects(running, /watch close failed/)
  assert.equal(f.children[0].child.exitCode, 0); assert.equal(f.lock.record.cleanupRequired, true)
  assert.equal(f.snapshot().state, 'cleanup-failed'); assert.equal(f.events.includes('release'), false)
})

for (const signal of ['SIGINT', 'SIGTERM']) for (const phase of ['prepare', 'readiness']) test(`${signal} interrupts ${phase} without losing cancellation during handoff`, async t => {
  let entered = false
  const f = fixture(t, phase === 'prepare' ? { async prepareGeneration({ execute }) { entered = true; await execute({ name: 'SDK build' }) } }
    : { async readiness() { entered = true; await new Promise(() => {}) } })
  const running = supervise(f.options)
  await waitFor(() => entered && f.children.length === 1); process.emit(signal); await running
  assert.equal(f.children[0].child.exitCode, 0); assert.equal(f.snapshot().state, 'stopped'); assert.equal(f.ready.length, 0)
})
