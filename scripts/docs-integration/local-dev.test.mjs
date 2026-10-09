import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { atomicJson, readJson, digest, LocalError } from './local-config.mjs'
import { Foundation } from './foundation.mjs'
import { acquireLock } from './ownership.mjs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { supervise, httpReady, downLocal, preparationJournal, localRecovery, controlRequest, localOwnershipCheck, initializeLocal } from './local-dev.mjs'
import { root } from './configure.mjs'

function recoveryFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'local-recovery-')), fingerprint = 'fixture-target', calls = []
  let generation = 'current', failStop = 0, stopCount = 0
  const identity = pid => ({ pid, creation: generation, executable: 'node', commandDigest: 'command' })
  const inspect = pid => pid === process.pid ? identity(pid) : null
  const state = { directory, workspace: '.', fingerprint }
  const containers = new Map(['postgres', 'redis', 'hydra'].map(service => [service, { Id: service, Image: 'fixture',
    Config: { Env: ['FIXTURE=value'], Labels: { 'com.docker.compose.project': 'fixture', 'com.docker.compose.service': service,
      'com.docker.compose.oneoff': 'False', 'com.docker.compose.config-hash': 'a'.repeat(64) } },
    HostConfig: { RestartPolicy: { Name: 'no' } }, Mounts: [], State: { Running: true } }]))
  const volumes = [{ name: 'fixture_data', createdAt: 'original', labels: { 'com.docker.compose.project': 'fixture', 'com.docker.compose.volume': 'data' } }]
  const runner = (_command, args) => {
    calls.push(args)
    if (args[0] === 'volume') return { status: 0, stdout: args[1] === 'ls' ? volumes.map(item => item.name).join('\n') : JSON.stringify([{ Name: volumes[0].name, CreatedAt: volumes[0].createdAt, Labels: volumes[0].labels }]) }
    if (args.includes('config')) return { status: 0, stdout: args.includes('--hash') ? `${args.at(-1)} ${'a'.repeat(64)}` : JSON.stringify({ services: { postgres: {}, redis: {}, hydra: {} }, volumes: { data: { name: 'fixture_data' } } }) }
    if (args[0] === 'ps') return { status: 0, stdout: [...containers.keys()].join('\n') }
    if (args[0] === 'inspect') return containers.has(args[1]) ? { status: 0, stdout: JSON.stringify([containers.get(args[1])]) } : { status: 1, stdout: '' }
    if (args[0] === 'stop') {
      if (++stopCount === failStop) return { status: 1, stdout: '' }
      containers.get(args.at(-1)).State.Running = false; return { status: 0, stdout: '' }
    }
    throw new Error(`Unexpected ${args[0]}`)
  }
  const foundation = () => new Foundation(state, { project: 'fixture', runner, environment: {} })
  const proof = id => foundation().containerProof(containers.get(id)), resource = id => ({ id, service: id })
  const journal = resources => ({ version: 1, mode: 'local', fingerprint, runId: randomUUID(),
    identity: { pid: 987654, creation: 'exited', executable: 'node', commandDigest: 'command' }, state: 'ready', resources })
  const prep = journal({ started: [resource('postgres')], preRunning: [resource('redis')], containerProofs: [proof('postgres'), proof('redis')] })
  const run = journal({ started: [resource('hydra')], preRunning: [resource('postgres'), resource('redis')], containerProofs: [...containers.keys()].map(proof) })
  atomicJson(join(directory, 'prepared.json'), { version: 1, fingerprint, stages: { initialized: true }, volumes })
  atomicJson(join(directory, 'foundation.json'), prep); atomicJson(join(directory, 'run.json'), run)
  const options = () => ({ state, foundation: foundation(), directory, inspect, control: async () => false, externalCheck: () => {} })
  return { directory, state, containers, volumes, calls, prep, run, foundation, proof, options, inspect,
    nextOwner() { generation = randomUUID() }, failStop(value) { failStop = value }, cleanup() { rmSync(directory, { recursive: true, force: true }) } }
}
test('active explicit down completes historical cleanup after control and keeps independent services', async () => {
  const f = recoveryFixture()
  try {
    atomicJson(join(f.directory, 'mode-lock.json'), f.run)
    let controls = 0
    await downLocal({ ...f.options(), control: async () => {
      controls++; f.containers.get('hydra').State.Running = false
      atomicJson(join(f.directory, 'run.json'), { ...f.run, state: 'stopped', children: [] })
      rmSync(join(f.directory, 'mode-lock.json')); return true
    } })
    assert.equal(controls, 1)
    assert.equal(f.containers.get('postgres').State.Running, false)
    assert.equal(f.containers.get('redis').State.Running, true)
    assert.equal(readJson(join(f.directory, 'run.json')).state, 'stopped')
    await downLocal(f.options())
    assert.deepEqual(f.calls.filter(args => args[0] === 'stop').map(args => args.at(-1)), ['postgres'])
  } finally { f.cleanup() }
})

test('bound stop control detects replacement while waiting and waits past lock removal for original identities', async () => {
  for (const phase of ['replacement', 'draining', 'release-during-inspect']) {
    const f = recoveryFixture(), childIdentity = { ...f.run.identity, pid: 987655 }
    const requested = { ...f.run, children: [{ identity: childIdentity }] }
    let ownerAlive = true, childAlive = true, ownerQueries = 0
    const inspect = pid => {
      if (pid === requested.identity.pid) {
        if (phase === 'release-during-inspect' && ++ownerQueries === 2) {
          rmSync(join(f.directory, 'mode-lock.json')); ownerAlive = false; childAlive = false
        }
        return ownerAlive ? requested.identity : null
      }
      return pid === childIdentity.pid && childAlive ? childIdentity : f.inspect(pid)
    }
    const replacement = { ...requested, runId: randomUUID() }
    let timer, drain
    try {
      atomicJson(join(f.directory, 'mode-lock.json'), requested)
      const pending = controlRequest('stop', 'local', undefined, { directory: f.directory, expectedRecord: requested, inspect })
      timer = setTimeout(() => {
        if (phase === 'replacement') atomicJson(join(f.directory, 'mode-lock.json'), replacement)
        if (phase === 'draining') {
          rmSync(join(f.directory, 'mode-lock.json'))
          drain = setTimeout(() => { ownerAlive = false; childAlive = false }, 600)
        }
      }, 20)
      if (phase === 'replacement') {
        await assert.rejects(pending, /MODE_OWNERSHIP_CHANGED/)
        assert.deepEqual(readJson(join(f.directory, 'mode-lock.json')), replacement)
      } else {
        assert.equal(await pending, true); assert.equal(ownerAlive, false); assert.equal(childAlive, false)
      }
      assert.equal(readJson(join(f.directory, 'control-request.json')).runId, requested.runId)
    } finally { clearTimeout(timer); clearTimeout(drain); f.cleanup() }
  }
})

test('active down refuses replacement at control submission and under the recovery gate without overwriting it', async () => {
  for (const phase of ['submission', 'handoff-lock', 'handoff-journal', 'handoff-history']) {
    const f = recoveryFixture()
    try {
      atomicJson(join(f.directory, 'mode-lock.json'), f.run)
      const replacement = { ...f.run, runId: randomUUID() }
      await assert.rejects(downLocal({ ...f.options(), control: async (action, mode, user, options) => {
        if (phase === 'submission') {
          atomicJson(join(f.directory, 'mode-lock.json'), replacement)
          return controlRequest(action, mode, user, options)
        }
        atomicJson(join(f.directory, 'run.json'), phase === 'handoff-journal' ? replacement : { ...f.run, state: 'stopped' })
        if (phase === 'handoff-history') atomicJson(join(f.directory, 'foundation.json'), { ...f.prep, runId: replacement.runId })
        if (phase === 'handoff-lock') atomicJson(join(f.directory, 'mode-lock.json'), replacement)
        else rmSync(join(f.directory, 'mode-lock.json'))
        return true
      } }), /MODE_OWNERSHIP_CHANGED/)
      assert.equal(f.calls.some(args => args[0] === 'stop'), false)
      if (phase === 'submission' || phase === 'handoff-lock') assert.deepEqual(readJson(join(f.directory, 'mode-lock.json')), replacement)
      else assert.equal(existsSync(join(f.directory, 'mode-lock.json')), false)
      assert.equal(existsSync(join(f.directory, 'retired-run.json')), false)
      assert.equal(existsSync(join(f.directory, 'control-request.json')), false)
    } finally { f.cleanup() }
  }
})

test('active down rejects still-live original owner or child after a claimed control completion', async () => {
  for (const role of ['owner', 'child']) {
    const f = recoveryFixture()
    try {
      const live = f.inspect(process.pid), requested = { ...f.run,
        ...(role === 'owner' ? { identity: live } : { children: [{ identity: live }] }) }
      atomicJson(join(f.directory, 'mode-lock.json'), requested)
      await assert.rejects(downLocal({ ...f.options(), control: async () => {
        atomicJson(join(f.directory, 'run.json'), { ...requested, state: 'stopped', children: [] })
        rmSync(join(f.directory, 'mode-lock.json')); return true
      } }), role === 'owner' ? /MODE_ACTIVE/ : /MODE_CHILDREN_STILL_ACTIVE/)
      assert.equal(f.calls.some(args => args[0] === 'stop'), false)
    } finally { f.cleanup() }
  }
})

test('active down post-control proof, stop and persistence failures retain the original recovery for a new owner', async () => {
  for (const fault of ['proof', 'stop', 'write']) {
    const f = recoveryFixture()
    try {
      atomicJson(join(f.directory, 'mode-lock.json'), f.run)
      if (fault === 'stop') f.failStop(1)
      let writes = 0
      await assert.rejects(downLocal({ ...f.options(), persist: (path, value) => {
        if (fault === 'write' && ++writes === 3) throw new Error('durable stopped failure')
        atomicJson(path, value)
      }, control: async () => {
        f.containers.get('hydra').State.Running = false
        if (fault === 'proof') f.containers.get('postgres').HostConfig.Privileged = true
        atomicJson(join(f.directory, 'run.json'), { ...f.run, state: 'stopped' })
        rmSync(join(f.directory, 'mode-lock.json')); return true
      } }), /CONFLICT|DOCKER_FAILED|durable stopped failure/)
      const retained = readJson(join(f.directory, 'mode-lock.json'))
      assert.equal(retained.cleanupRequired, true); assert.equal(retained.recovery.runId, f.run.runId)
      assert.deepEqual(retained.recovery.identity, f.run.identity)
      assert.equal(retained.resources.containerProofs.length, 3)
      for (const mode of ['local', 'dev', 'full']) assert.throws(() => acquireLock({ mode, fingerprint: f.state.fingerprint, directory: f.directory, inspect: f.inspect }), /CLEANUP_REQUIRED/)
      delete f.containers.get('postgres').HostConfig.Privileged
      f.nextOwner(); await downLocal(f.options())
      assert.equal(f.containers.get('redis').State.Running, true)
      assert.equal(f.containers.get('postgres').State.Running, false)
      assert.equal(existsSync(join(f.directory, 'mode-lock.json')), false)
    } finally { f.cleanup() }
  }
})

test('local final restore observing an owned restart retains cleanup intent and never certifies stopped', async () => {
  const f = recoveryFixture(), foundation = f.foundation(), restore = foundation.restore.bind(foundation)
  let restores = 0
  foundation.restore = (...args) => {
    if (++restores === 2) f.containers.get('postgres').State.Running = true
    return restore(...args)
  }
  try {
    atomicJson(join(f.directory, 'mode-lock.json'), f.run)
    await assert.rejects(downLocal({ ...f.options(), foundation }), /FOUNDATION_STOP_INCOMPLETE/)
    const retained = readJson(join(f.directory, 'mode-lock.json'))
    assert.equal(retained.cleanupRequired, true); assert.equal(retained.recovery.runId, f.run.runId)
    assert.equal(readJson(join(f.directory, 'run.json')).state, 'cleanup-failed')
    assert.equal(f.containers.get('postgres').State.Running, true)
    assert.equal(f.containers.get('redis').State.Running, true)
    f.nextOwner(); await downLocal(f.options())
    assert.equal(f.containers.get('postgres').State.Running, false)
    assert.equal(f.containers.get('redis').State.Running, true)
  } finally { f.cleanup() }
})

test('first initialize journal-write failure retains original full proofs and blocks competitors until exact down', async () => {
  const f = recoveryFixture()
  try {
    await assert.rejects(initializeLocal({ ...f.state, workspace: root }, { foundation: f.foundation(), directory: f.directory,
      inspect: f.inspect, externalCheck: () => {}, persist: () => { throw new Error('first preparation journal write failed') } }), /journal write failed/)
    const retained = readJson(join(f.directory, 'mode-lock.json'))
    assert.equal(retained.cleanupRequired, true); assert.equal(retained.resources.containerProofs.length, 3)
    assert.equal(f.calls.some(args => args.includes('up') || args[0] === 'stop'), false)
    f.nextOwner()
    for (const mode of ['local', 'dev', 'full']) assert.throws(() => acquireLock({ mode, fingerprint: f.state.fingerprint, directory: f.directory, inspect: f.inspect }), /CLEANUP_REQUIRED/)
    await downLocal(f.options()); assert.equal(existsSync(join(f.directory, 'mode-lock.json')), false)
    assert.equal(f.containers.get('redis').State.Running, true)
  } finally { f.cleanup() }
})
test('partial preparation down restores original volumes without manufacturing prepared and protects unknown/tampered targets', async () => {
  for (const change of ['none', 'volume', 'proof', 'unknown']) {
    const f = recoveryFixture()
    try {
      rmSync(join(f.directory, 'prepared.json')); rmSync(join(f.directory, 'run.json'))
      const partial = { ...f.prep, resources: { ...f.prep.resources, started: [
        ...f.prep.resources.started, { id: 'hydra', service: 'hydra' }], containerProofs: [...f.prep.resources.containerProofs, f.proof('hydra')] },
        preparation: { version: 1, status: 'partial', stage: 'databases', volumes: structuredClone(f.volumes) } }
      atomicJson(join(f.directory, 'foundation.json'), partial); atomicJson(join(f.directory, 'mode-lock.json'), partial)
      if (change === 'volume') f.volumes[0].createdAt = 'replacement'
      if (change === 'proof') f.containers.get('postgres').HostConfig.Privileged = true
      if (change === 'unknown') f.containers.set('unknown', { ...f.containers.get('postgres'), Id: 'unknown' })
      if (change === 'none') {
        await downLocal(f.options()); assert.equal(f.containers.get('postgres').State.Running, false)
        assert.equal(f.containers.get('redis').State.Running, true); await downLocal(f.options())
      } else {
        await assert.rejects(downLocal(f.options()), /IDENTITY_CHANGED|CONFLICT|OWNER_UNKNOWN/)
        assert.equal(f.calls.some(args => args[0] === 'stop'), false)
        assert.equal(readJson(join(f.directory, 'mode-lock.json')).cleanupRequired, true)
      }
      assert.equal(existsSync(join(f.directory, 'prepared.json')), false)
    } finally { f.cleanup() }
  }
})
test('genuine empty preflight journal recovers only an empty exact target inventory', () => {
  for (const unknown of [false, true]) {
    const f = recoveryFixture()
    try {
      for (const name of ['prepared.json', 'foundation.json', 'run.json']) rmSync(join(f.directory, name))
      const prior = { ...f.run, state: 'preflight' }; delete prior.resources
      f.containers.clear()
      if (unknown) f.containers.set('unknown', { Id: 'unknown' })
      const foundation = f.foundation(); foundation.configuration = () => ({ services: {}, volumes: {} }); foundation.verifyVolumeInventory = () => {}
      if (unknown) assert.throws(() => localOwnershipCheck(f.state, foundation, { externalCheck: () => {} })(prior), /OWNER_UNKNOWN/)
      else assert.doesNotThrow(() => localOwnershipCheck(f.state, foundation, { externalCheck: () => {} })(prior))
      assert.equal(f.calls.some(args => args[0] === 'stop' || args.includes('up')), false)
    } finally { f.cleanup() }
  }
})
test('production down restores the latest runtime plus preparation ownership and preserves independent preRunning; second down is idempotent', async () => {
  const f = recoveryFixture()
  try {
    atomicJson(join(f.directory, 'mode-lock.json'), f.run)
    await downLocal(f.options())
    assert.deepEqual(f.calls.filter(args => args[0] === 'stop').map(args => args.at(-1)), ['hydra', 'postgres'])
    assert.equal(f.containers.get('redis').State.Running, true)
    assert.equal(existsSync(join(f.directory, 'mode-lock.json')), false)
    assert.equal(readJson(join(f.directory, 'retired-run.json')).runId, f.run.runId)
    await downLocal(f.options())
    assert.equal(f.calls.filter(args => args[0] === 'stop').length, 2)
  } finally { f.cleanup() }
})
test('repeat preparation retains historical owned IDs while invalid runtime provenance never falls back to init', () => {
  const f = recoveryFixture()
  try {
    const lock = acquireLock({ mode: 'local', fingerprint: f.state.fingerprint, directory: f.directory, inspect: f.inspect })
    preparationJournal(f.state, lock, { started: [], preRunning: f.prep.resources.started.concat(f.prep.resources.preRunning), containerProofs: f.prep.resources.containerProofs })
    assert.deepEqual(readJson(join(f.directory, 'foundation.json')).resources.started, f.prep.resources.started)
    lock.release()
    atomicJson(join(f.directory, 'run.json'), { ...f.run, identity: { pid: 1234 } })
    assert.throws(() => localRecovery(f.state), /PROVENANCE_INVALID/)
  } finally { f.cleanup() }
})
test('production down refuses every historical proof, unknown ID and prepared-volume change before any stop', async () => {
  const changes = [
    f => { f.containers.get('postgres').HostConfig.RestartPolicy.Name = 'always' },
    f => { f.containers.get('postgres').Config.Env = ['CHANGED=yes'] },
    f => { f.containers.get('postgres').Image = 'changed-image' },
    f => { f.containers.get('postgres').Mounts.push({ Destination: '/data', Source: 'changed' }) },
    f => { f.volumes[0].createdAt = 'replacement' },
    f => { const value = readJson(join(f.directory, 'foundation.json')); value.resources.containerProofs = []; atomicJson(join(f.directory, 'foundation.json'), value)
      const run = readJson(join(f.directory, 'run.json')); run.resources.containerProofs = run.resources.containerProofs.filter(proof => proof.id !== 'postgres'); atomicJson(join(f.directory, 'run.json'), run) },
    f => { f.containers.set('unknown', { ...f.containers.get('postgres'), Id: 'unknown' }) },
  ]
  for (const change of changes) {
    const f = recoveryFixture()
    try {
      change(f); await assert.rejects(downLocal(f.options()), /CONFLICT|IDENTITY_CHANGED|JOURNAL_INVALID|OWNER_UNKNOWN/)
      assert.equal(f.calls.some(args => args[0] === 'stop'), false)
      assert.equal(readJson(join(f.directory, 'mode-lock.json')).cleanupRequired, true)
      for (const mode of ['local', 'dev', 'full']) assert.throws(() => acquireLock({ mode, fingerprint: f.state.fingerprint, directory: f.directory, inspect: f.inspect }), /CLEANUP_REQUIRED/)
    } finally { f.cleanup() }
  }
})
test('first/middle stop and first/intermediate/final journal-write failures retain durable intent across owner exit and exact retry', async () => {
  for (const fault of ['stop1', 'stop2', 'write1', 'write2', 'write3']) {
    const f = recoveryFixture(); let writes = 0
    try {
      if (fault.startsWith('stop')) f.failStop(Number(fault.at(-1)))
      const persist = (path, value) => { if (++writes === Number(fault.replace('write', ''))) throw new Error('fixture write failure'); atomicJson(path, value) }
      await assert.rejects(downLocal({ ...f.options(), persist }))
      const retained = readJson(join(f.directory, 'mode-lock.json'))
      assert.equal(retained.cleanupRequired, true); assert.ok(retained.resources.containerProofs.length)
      f.nextOwner()
      for (const mode of ['local', 'dev', 'full']) assert.throws(() => acquireLock({ mode, fingerprint: 'other', directory: f.directory, inspect: f.inspect }), /CLEANUP_REQUIRED/)
      f.failStop(0); await downLocal(f.options())
      assert.equal(existsSync(join(f.directory, 'mode-lock.json')), false)
      assert.equal(f.containers.get('hydra').State.Running, false); assert.equal(f.containers.get('redis').State.Running, true)
    } finally { f.cleanup() }
  }
})
test('production down retains complete intent and issues zero stops when historical inspect or global inventory fails', async () => {
  for (const code of ['DOCKER_INSPECTION_FAILED', 'LOCAL_DOCKER_FAILED', 'DOCKER_INVENTORY_INVALID']) {
    const f = recoveryFixture()
    try {
      const foundation = f.foundation(), inspect = foundation.inspect.bind(foundation)
      foundation.inspect = id => { if (id === 'postgres') throw new LocalError(code); return inspect(id) }
      await assert.rejects(downLocal({ ...f.options(), foundation }), error => error.code === code)
      assert.equal(f.calls.some(args => args[0] === 'stop'), false)
      const retained = readJson(join(f.directory, 'mode-lock.json'))
      assert.equal(retained.cleanupRequired, true); assert.equal(retained.resources.containerProofs.length, 3)
      for (const mode of ['local', 'dev', 'full']) assert.throws(() => acquireLock({ mode, fingerprint: f.state.fingerprint, directory: f.directory, inspect: f.inspect }), /CLEANUP_REQUIRED/)
      // This no-prior-lock failure created the current live owner's protected
      // record. A fresh acquisition must wait for that complete identity to exit.
      await assert.rejects(downLocal(f.options()), /MODE_ACTIVE/)
      assert.equal(f.calls.some(args => args[0] === 'stop'), false)
      f.nextOwner()
      await downLocal(f.options())
      assert.equal(existsSync(join(f.directory, 'mode-lock.json')), false)
      assert.equal(f.containers.get('redis').State.Running, true)
    } finally { f.cleanup() }
  }
})
test('production control rejects bootstrap immediately during cleanup intent and routes explicit stop to exact recovery', async () => {
  const f = recoveryFixture()
  try {
    for (const extra of [{ cleanupRequired: true }, { state: 'cleanup-failed' }]) {
      atomicJson(join(f.directory, 'mode-lock.json'), { ...f.run, ...extra })
      await assert.rejects(controlRequest('bootstrap', 'local', randomUUID(), { directory: f.directory }), /CLEANUP_REQUIRED/)
      assert.equal(await controlRequest('stop', 'local', undefined, { directory: f.directory }), false)
      assert.equal(existsSync(join(f.directory, 'control-request.json')), false)
    }
  } finally { f.cleanup() }
})
test('normal stale dev/full acquisition preserves separately proven stopped foreign receipts and never transfers their IDs into local ownership', () => {
  for (const mode of ['dev', 'full']) {
    const f = recoveryFixture()
    try {
      const foreign = new Foundation(f.state, { project: 'foreign', environment: {} })
      const actual = { ...structuredClone(f.containers.get('postgres')), Id: 'foreign-owned', State: { Running: false } }
      actual.Config.Labels['com.docker.compose.project'] = 'foreign'
      foreign.inspect = id => id === actual.Id ? actual : null; foreign.containers = () => [actual]
      const prior = { ...f.run, mode, fingerprint: 'original-foreign-target', state: 'stopped', stoppedAt: new Date().toISOString(),
        resources: { started: [{ id: actual.Id, service: 'postgres' }], preRunning: [], containerProofs: [foreign.containerProof(actual)] } }
      atomicJson(join(f.directory, 'mode-lock.json'), prior)
      const foundation = f.foundation(), check = localOwnershipCheck(f.state, foundation, { externalCheck: () => {}, legacyFoundation: foreign })
      const lock = acquireLock({ mode: 'local', fingerprint: f.state.fingerprint, directory: f.directory, inspect: f.inspect, externalCheck: check })
      assert.deepEqual(readJson(join(f.directory, 'retired-legacy-run.json')), prior)
      assert.equal(localRecovery(f.state).resources.started.some(item => item.id === actual.Id), false)
      assert.equal(f.calls.some(argv => argv[0] === 'stop'), false); lock.release()
      foreign.containers = () => []; foreign.inspect = () => null
      const empty = { ...prior, state: 'preflight', resources: undefined }
      atomicJson(join(f.directory, 'mode-lock.json'), empty)
      const emptyLock = acquireLock({ mode: 'local', fingerprint: f.state.fingerprint, directory: f.directory, inspect: f.inspect, externalCheck: check })
      assert.equal(readJson(join(f.directory, 'retired-legacy-run.json')).runId, prior.runId); emptyLock.release()
    } finally { f.cleanup() }
  }
})
test('foreign pending, unknown, missing or changed provenance fails acquisition with zero mutations and retains the original receipt', () => {
  for (const change of ['running', 'proof', 'missing-proof', 'unknown', 'mode', 'identity', 'cleanup']) {
    const f = recoveryFixture()
    try {
      const foreign = new Foundation(f.state, { project: 'foreign', environment: {} })
      const actual = { ...structuredClone(f.containers.get('postgres')), Id: 'foreign-owned', State: { Running: false } }
      actual.Config.Labels['com.docker.compose.project'] = 'foreign'
      const prior = { ...f.run, mode: 'dev', fingerprint: 'foreign-target', state: 'stopped',
        resources: { started: [{ id: actual.Id, service: 'postgres' }], preRunning: [], containerProofs: [foreign.containerProof(actual)] } }
      foreign.inspect = id => id === actual.Id ? actual : null; foreign.containers = () => [actual]
      if (change === 'running') actual.State.Running = true
      if (change === 'proof') actual.HostConfig.RestartPolicy.Name = 'always'
      if (change === 'missing-proof') prior.resources.containerProofs = []
      if (change === 'unknown') foreign.containers = () => [actual, { ...actual, Id: 'unknown' }]
      if (change === 'mode') prior.mode = 'unknown'
      if (change === 'identity') prior.identity = { pid: 1234 }
      if (change === 'cleanup') prior.cleanupRequired = true
      atomicJson(join(f.directory, 'mode-lock.json'), prior)
      const before = readFileSync(join(f.directory, 'mode-lock.json'))
      assert.throws(() => acquireLock({ mode: 'local', fingerprint: f.state.fingerprint, directory: f.directory, inspect: f.inspect,
        externalCheck: localOwnershipCheck(f.state, f.foundation(), { externalCheck: () => {}, legacyFoundation: foreign }) }), /FOREIGN_|OWNERSHIP_CONFLICT|AMBIGUOUS|CLEANUP_REQUIRED/)
      assert.deepEqual(readFileSync(join(f.directory, 'mode-lock.json')), before)
      assert.equal(existsSync(join(f.directory, 'retired-legacy-run.json')), false)
      assert.equal(f.calls.some(argv => argv[0] === 'stop' || argv.includes('up')), false)
    } finally { f.cleanup() }
  }
})
async function httpFixture(handler, run) {
  const server = createHttpServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try { await run(`http://127.0.0.1:${server.address().port}`) }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
}
test('production readiness actually sends explicit Host and rejects the gateway 421 default host', async () => {
  const hosts = []
  await httpFixture((request, response) => {
    hosts.push(request.headers.host); response.writeHead(request.headers.host === 'exwebsite.test' ? 200 : 421); response.end('ok')
  }, async origin => {
    await httpReady(`${origin}/api/health`, { headers: { Host: 'exwebsite.test' }, timeout: 600 })
    assert.deepEqual(hosts, ['exwebsite.test'])
    await assert.rejects(httpReady(origin, { headers: { hOsT: 'foreign.test' }, timeout: 300 }), /APPLICATION_NOT_READY/)
    assert.equal(hosts.slice(1).every(host => host === 'foreign.test'), true)
  })
})
test('readiness expected receives a Response, retries mismatched JSON and accepts empty 204 bodies', async () => {
  let calls = 0, checks = 0
  await httpFixture((_request, response) => {
    calls++; response.setHeader('Content-Type', 'application/json'); response.setHeader('X-Fixture', 'ready')
    response.end(JSON.stringify({ issuer: calls === 1 ? 'wrong' : 'expected' }))
  }, async origin => {
    await httpReady(new URL('/issuer', origin), { headers: new Headers({ Host: 'exwebsite.test' }), timeout: 1500,
      expected: async response => {
        checks++; assert.ok(response instanceof Response); assert.equal(response.url, `${origin}/issuer`)
        assert.equal(response.status, 200); assert.equal(response.redirected, false); assert.equal(response.headers.get('x-fixture'), 'ready')
        return (await response.json()).issuer === 'expected'
      } })
    assert.equal(checks, 2)
    await assert.rejects(httpReady(origin, { headers: [['Host', 'exwebsite.test']], timeout: 300, expected: () => { throw new Error('private expected failure') } }), /APPLICATION_NOT_READY/)
  })
  await httpFixture((_request, response) => { response.writeHead(204); response.end() }, async origin => {
    await httpReady(origin, { headers: { Host: 'exwebsite.test' }, timeout: 500, expected: async response => response.status === 204 && await response.text() === '' })
  })
})
test('readiness redirects stay manual with and without explicit Host', async () => {
  let redirected = 0
  await httpFixture((request, response) => {
    if (request.url === '/destination') { redirected++; response.end('ok'); return }
    response.writeHead(302, { Location: '/destination' }); response.end()
  }, async origin => {
    for (const headers of [undefined, { Host: 'exwebsite.test' }]) {
      await assert.rejects(httpReady(origin, { headers, timeout: 300 }), /APPLICATION_NOT_READY/)
    }
    assert.equal(redirected, 0)
  })
})
test('readiness bounds silent headers, stalled bodies and expected callbacks by the total deadline', async () => {
  for (const mode of ['headers', 'body', 'expected']) {
    await httpFixture((_request, response) => {
      if (mode === 'headers') return
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.flushHeaders()
      if (mode === 'expected') response.end('{}')
      else response.write('{')
    }, async origin => {
      const start = Date.now()
      await assert.rejects(httpReady(origin, { headers: { Host: 'exwebsite.test' }, timeout: 180,
        expected: mode === 'expected' ? () => new Promise(() => {}) : response => response.json() }), /APPLICATION_NOT_READY/)
      assert.ok(Date.now() - start < 900, `${mode} exceeded bounded deadline`)
    })
  }
})
test('readiness aborts in-flight HTTP when a mandatory child exits and never declares it ready', async () => {
  await httpFixture((_request, response) => { response.writeHead(200); response.flushHeaders() }, async origin => {
    const child = { exitCode: null, signalCode: null }, start = Date.now()
    const timer = setTimeout(() => { child.exitCode = 7 }, 80)
    try {
      await assert.rejects(httpReady(origin, { headers: { Host: 'exwebsite.test' }, children: [{ child }], timeout: 1500,
        expected: response => response.text() }), /APP_EXITED_DURING_START/)
      assert.ok(Date.now() - start < 900)
    } finally { clearTimeout(timer) }
    await assert.rejects(httpReady(origin, { children: [{ child }], timeout: 500 }), /APP_EXITED_DURING_START/)
  })
})

// Public test-only key/certificate. Runtime never uses this pair.
const testTlsKey = "-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQC6ZDhvw6FyzyOM\ndV1bYUyo3ADXLykJm78hJvINVS9A2UwVMoKR2Ecz/oBEAo3FvoF6ODCJDjFgYk5J\nH5lDfmvPdmFN0xCQWhXZX4Dy0p3trVtq0/Y6YWWEoLAglAF/4QqaXhBas3dE9a7H\nSGYegIKAgYVeVZQ4EZqVRZ9uvK5QXk7t10UYBofPuX717Cg+H3fFtF0tKnYq6LvY\nrJm4YuDBJyZaqn/OWrR5+zatMCSVmRzpOP5ygt2CnkoVoP4BDBtx9NTnwgMO3EmN\nA93yEXGkewa8UgQ4eeYg2bgZm2UnNwXXuP5NwuWx2zR6yFxg6trYDrtW/5C9lxMA\n2cZycF/nAgMBAAECggEAE+/YYYwJXuBtKv76x2V277Donhu7Rf3UydUCmw57iXI0\nwyet86+wng0g5yVmyLoB23LbLi3IdkjNmuC4YhHJsl01Nz/WS7p3D9M5Vb/ViLC8\nUIbvlXsJgtA1RqbOKkGGAtEA6tK7dTLaSRKjaavRSbGQ9HAu9Hhdko3p6cxg0NO2\n1X3cAbWB3BuhsZMwtFTG6lCMpMu5qKYKxdjtHkQYDKfGrpn7t0lKIY+EPIyeQM0f\nrGf47pAMMYMJ37HkVNYMFe6Ktl7TdGaB3Lw2aOwPIYpcrT288dx6vRiMJBmRHjp4\nqKUDAfxRQAqhckVdUDcWK0JU/PGXVPyR2VfBjsO9sQKBgQDjHM3a1IglvHH26zvG\nN5nErviVzFhIYsMPKjvgxx/F6m7s1VH/5fWKP9lkwOI+umkuIuJ5Wwn2GFarm40l\ndARo1s6J8WhgGgu0Z/eTt8wz3VwYdStNxj07ttJOZQYN217UUgXE1lQ2Vw2EqXiY\npSe+IqM5WwR/BkYkogUzCWPFIwKBgQDSGXc11ncFn2LIMtPxRYAaZf/2OEVqwV2R\n9A6YsFwSjtspSuP92lXGbOgggpYaicWk8zJRJEqR5zQj5DYG511pRrGzJ6sCAfaN\nk410CYliYn4E3H/1fjx/aPWej8hZtsmzDUWIh+QDQ0oXD6goB9qLIVpC+n+yc+e5\no8sMRSPQbQKBgQCnRnngaZV1pdySryOxlRYupWj2fDGx7vwYWVUM89zVGxxkV6Iz\nxp4ZG3n1GZQJ+6aoko0YMROfLMH5V3KYWWE+DqjFNQdZcRWZ5NGW/VLsCGhiozon\n6JEFQFyZ3RKedircWyVgmzQfafLM+T2XwF0LT9vEzOL85BQZuzP1KT9Q3QKBgQCM\nzkhYqp0mBYXcikQExQFvr8B1sYzEWUduk9RcfIWYYml7KRfXf8ZQr5h6gUo8Cu2M\n+PhV7S6UzhDhpQaYZeLytVBOs10mgU5N3//DLskGSOAQPf779lhxQ1Spqc8qYRiY\niWJ6eChWD3jOL84Q1gKfkADANsXyQT+h6KYiWQwBmQKBgQCppj7MyvvsFD+lHagD\n0sNRwJihqfwqvp5VoPlQwI0s3+GEwn4ZfZM0v+PEZdUuYPjRVYZ+jpjRmIN4jNBj\n5F5jPkre9KNUAKCLP7Z5oJW+8C7ZKOT4/ObRvdlIkBhrvpyr6gGcR2+WC+7DaYV+\nBQehEH/osbQwQ2v2xKdlPa41pw==\n-----END PRIVATE KEY-----\n"
const testTlsCert = "-----BEGIN CERTIFICATE-----\nMIIDNDCCAhygAwIBAgIUFEoKPlu9opD85XMnP1q+4dc+pVQwDQYJKoZIhvcNAQEL\nBQAwGTEXMBUGA1UEAwwOZXh3ZWJzaXRlLnRlc3QwHhcNMjYxMDA0MjEzOTMxWhcN\nMzYxMDAxMjEzOTMxWjAZMRcwFQYDVQQDDA5leHdlYnNpdGUudGVzdDCCASIwDQYJ\nKoZIhvcNAQEBBQADggEPADCCAQoCggEBALpkOG/DoXLPI4x1XVthTKjcANcvKQmb\nvyEm8g1VL0DZTBUygpHYRzP+gEQCjcW+gXo4MIkOMWBiTkkfmUN+a892YU3TEJBa\nFdlfgPLSne2tW2rT9jphZYSgsCCUAX/hCppeEFqzd0T1rsdIZh6AgoCBhV5VlDgR\nmpVFn268rlBeTu3XRRgGh8+5fvXsKD4fd8W0XS0qdirou9ismbhi4MEnJlqqf85a\ntHn7Nq0wJJWZHOk4/nKC3YKeShWg/gEMG3H01OfCAw7cSY0D3fIRcaR7BrxSBDh5\n5iDZuBmbZSc3Bde4/k3C5bHbNHrIXGDq2tgOu1b/kL2XEwDZxnJwX+cCAwEAAaN0\nMHIwHQYDVR0OBBYEFDYndgjqUHSTNU0sLJZAk94u4WWkMB8GA1UdIwQYMBaAFDYn\ndgjqUHSTNU0sLJZAk94u4WWkMA8GA1UdEwEB/wQFMAMBAf8wHwYDVR0RBBgwFoIO\nZXh3ZWJzaXRlLnRlc3SHBH8AAAEwDQYJKoZIhvcNAQELBQADggEBAA7F7zdoVqnA\nUp+jNMCjOw8z/sa2jE7M79TGsnpLSbZVPz7aoZBL+jqj86+TmQx7ZA7zD7tL7t0H\nJ8as50vpWFoAXhMorMDzzU1utgRzuqeaYmo3zzBQZbrzdxgHwaanf3Eu6sQSjEuZ\nK+5u0riBoaZBJsaTNtbLUsrBAvlw6R5IESykyslY9PYfBq0BdTbn/lDjAEkgrmq1\ndAezd2QmKA2zod72trwm6vjF/3ybqY0TZ0DJuSqdacoAqRts8jyI/uyJY1330bs5\nbLKVHuVS0G9m4FcEAAo6zKblQuHnl6xXO3ng2xkOTKFAd8ET0mw/7qbxr5P1VQZU\nhzssROStr/4=\n-----END CERTIFICATE-----\n"
test('explicit Host HTTPS keeps certificate verification and accepts only an explicitly trusted test CA', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'readiness-tls-')), certPath = join(directory, 'cert.pem')
  writeFileSync(certPath, testTlsCert)
  const hosts = [], server = createHttpsServer({ key: testTlsKey, cert: testTlsCert }, (request, response) => {
    hosts.push(request.headers.host); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ready: true }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const url = `https://127.0.0.1:${server.address().port}/health`
    await assert.rejects(httpReady(url, { headers: { Host: 'exwebsite.test' }, timeout: 300 }), /APPLICATION_NOT_READY/)
    assert.deepEqual(hosts, [])
    const source = `import { httpReady } from ${JSON.stringify(pathToFileURL(resolve('scripts/docs-integration/local-dev.mjs')).href)};await httpReady(${JSON.stringify(url)},{headers:{Host:'exwebsite.test'},timeout:1500,expected:async r=>r instanceof Response&&(await r.json()).ready});console.log('TRUSTED_TLS_READY '+process.version)`
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], { windowsHide: true, shell: false,
      env: { ...process.env, NODE_EXTRA_CA_CERTS: certPath } })
    let output = ''; child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
    const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
    assert.equal(exit, 0, output); assert.ok(output.includes('TRUSTED_TLS_READY')); assert.deepEqual(hosts, ['exwebsite.test'])
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true }) }
})
async function waitFor(predicate) {
  for (let count = 0; count < 200; count++) { if (predicate()) return; await delay(25) }
  throw new Error('Fixture timed out')
}
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'supervisor-')), events = [], all = []
  const lock = { record: { runId: randomUUID(), identity: { pid: process.pid }, mode: 'dev', fingerprint: 'target' },
    update(extra) { Object.assign(this.record, extra) }, release() { events.push('release') } }
  const spawnChild = async specification => {
    let finish
    const owned = { specification, child: { exitCode: null, signalCode: null },
      identity: { pid: all.length + 1 }, exited: new Promise(resolve => { finish = resolve }), finish: result => finish(result) }
    all.push(owned); events.push(`start:${specification.name}`); return owned
  }
  const stopChildren = async children => {
    for (const owned of children) { events.push(`stop:${owned.specification.name}`); owned.child.exitCode = 0; owned.finish({ code: 0 }) }
  }
  const foundation = { snapshot: () => ({ preRunning: [{ id: 'independent', service: 'postgres' }], started: [{ id: 'owned', service: 'hydra' }] }),
    async stopStarted() { events.push('stop:owned-hydra') } }
  const state = () => existsSync(join(directory, 'run.json')) ? JSON.parse(readFileSync(join(directory, 'run.json'), 'utf8')).state : undefined
  const request = (action, extra = {}) => atomicJson(join(directory, 'control-request.json'), {
    action, mode: 'dev', fingerprint: 'target', runId: lock.record.runId, requestId: randomUUID(), ...extra })
  const options = { mode: 'dev', fingerprint: 'target', directory, controlDirectory: directory, lock, foundation,
    specifications: ['server', 'web', 'outline'].map(name => ({ name })), spawnChild, stopChildren,
    readiness: async () => {}, onLog() {}, banner: 'FIXTURE_READY', pollInterval: 10 }
  return { directory, events, all, options, state, request, lock }
}
test('legacy awaiting runs Website only; runId-bound prepare pauses all apps and gateway before resuming the full set', async () => {
  const f = fixture()
  let prepared = 0
  const running = supervise({ ...f.options, awaitingBootstrap: true,
    onPause: async () => f.events.push('stop:gateway'),
    prepare: async () => {
      prepared++
      assert.equal(f.all.every(child => child.child.exitCode === 0), true)
      assert.equal(f.events.at(-1), 'stop:gateway')
      f.events.push('prepare');
    } })
  try {
    await waitFor(() => f.state() === 'awaiting-bootstrap')
    assert.deepEqual(f.events, ['start:server', 'start:web'])
    f.request('stop', { runId: 'foreign-run' }); await delay(50)
    assert.equal(f.state(), 'awaiting-bootstrap')
    f.request('bootstrap', { adminUserId: randomUUID() })
    await waitFor(() => f.state() === 'ready')
    assert.equal(prepared, 1)
    assert.deepEqual(f.events.slice(2), ['stop:server', 'stop:web', 'stop:gateway', 'prepare', 'start:server', 'start:web', 'start:outline'])
    f.request('stop'); await running
    assert.equal(f.state(), 'stopped')
    assert.deepEqual(f.events.slice(-5), ['stop:server', 'stop:web', 'stop:outline', 'stop:owned-hydra', 'release'])
  } finally { if (f.state() !== 'stopped') { f.request('stop'); await running.catch(() => {}) }; rmSync(f.directory, { recursive: true, force: true }) }
})
test('failed preparation stays safely stopped and the same owner can retry and resume', async () => {
  const f = fixture(); let attempts = 0
  const running = supervise({ ...f.options, awaitingBootstrap: true,
    prepare: async () => { attempts++; if (attempts === 1) throw new Error('fixture failure') } })
  try {
    await waitFor(() => f.state() === 'awaiting-bootstrap')
    f.request('bootstrap', { adminUserId: randomUUID() })
    await waitFor(() => f.state() === 'preparation-failed')
    assert.equal(f.all.every(child => child.child.exitCode === 0), true)
    assert.equal(f.events.filter(value => value.startsWith('start:')).length, 2)
    f.request('bootstrap', { adminUserId: randomUUID() })
    await waitFor(() => f.state() === 'ready')
    assert.equal(attempts, 2)
    f.request('stop'); await running
  } finally { if (f.state() !== 'stopped') { f.request('stop'); await running.catch(() => {}) }; rmSync(f.directory, { recursive: true, force: true }) }
})
test('unexpected mandatory child exit cleans all siblings and only this run foundation', async () => {
  const f = fixture(), running = supervise(f.options)
  try {
    await waitFor(() => f.state() === 'ready')
    f.all[1].child.exitCode = 7; f.all[1].finish({ code: 7 })
    await assert.rejects(running, /APP_WEB_EXITED_7/)
    assert.equal(f.all.every(child => child.child.exitCode === 0), true)
    assert.equal(f.events.includes('stop:owned-hydra'), true)
    assert.equal(f.events.some(value => value.includes('independent')), false)
    assert.equal(f.state(), 'stopped')
  } finally { rmSync(f.directory, { recursive: true, force: true }) }
})
test('supervisor retains cleanup-required ownership when its owned foundations are observed running after stop', async () => {
  const f = fixture(), original = f.options.foundation.snapshot()
  f.options.foundation.stopStarted = async () => { throw new LocalError('FOUNDATION_STOP_INCOMPLETE') }
  const running = supervise(f.options)
  try {
    await waitFor(() => f.state() === 'ready'); f.request('stop')
    await assert.rejects(running, /FOUNDATION_STOP_INCOMPLETE/)
    assert.equal(f.events.includes('release'), false); assert.equal(f.lock.record.cleanupRequired, true)
    const retained = readJson(join(f.directory, 'run.json'))
    assert.equal(retained.state, 'cleanup-failed'); assert.deepEqual(retained.resources, original)
    assert.equal(f.all.every(child => child.child.exitCode === 0), true)
  } finally { rmSync(f.directory, { recursive: true, force: true }) }
})
test('startup failure clears partially spawned children before releasing mode ownership', async () => {
  const f = fixture(); let starts = 0
  try {
    await assert.rejects(supervise({ ...f.options, spawnChild: async spec => { starts++; if (starts === 2) throw new Error('spawn failure'); return f.options.spawnChild(spec) } }), /spawn failure/)
    assert.deepEqual(f.events, ['start:server', 'stop:server', 'stop:owned-hydra', 'release'])
    assert.equal(f.state(), 'stopped')
  } finally { rmSync(f.directory, { recursive: true, force: true }) }
})
test('a resumed gateway is paused again when any application readiness fails', async () => {
  const f = fixture(); let gateway = false
  const running = supervise({ ...f.options, awaitingBootstrap: true,
    onPause: async () => { gateway = false }, prepare: async () => {},
    readiness: async (_children, limited) => { gateway = true; if (!limited) throw new Error('readiness failed') } })
  try {
    await waitFor(() => f.state() === 'awaiting-bootstrap')
    f.request('bootstrap', { adminUserId: randomUUID() })
    await waitFor(() => f.state() === 'preparation-failed')
    assert.equal(gateway, false); assert.equal(f.all.every(child => child.child.exitCode === 0), true)
    f.request('stop'); await running
  } finally { if (f.state() !== 'stopped') { f.request('stop'); await running.catch(() => {}) }; rmSync(f.directory, { recursive: true, force: true }) }
})
