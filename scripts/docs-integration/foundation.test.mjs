import assert from 'node:assert/strict'
import test from 'node:test'
import { Foundation } from './foundation.mjs'
const configuration = { services: {}, volumes: { pgdata: { name: 'fixture_pgdata' }, redisdata: { name: 'fixture_redisdata' } } }
test('failed up records its unique never-started container and a quickly exited container separately', async () => {
  for (const started of [false, true]) {
    const foundation = adapter().foundation
    let created = false, snapshot
    const actual = { Id: 'new', Image: 'image', Config: { Labels: { 'com.docker.compose.project': 'fixture',
      'com.docker.compose.service': 'redis', 'com.docker.compose.oneoff': 'False' } }, HostConfig: {}, Mounts: [],
      State: { Running: false, StartedAt: started ? '2026-10-05T00:00:00Z' : '0001-01-01T00:00:00Z' } }
    foundation.containers = () => created ? [actual] : []
    foundation.verifyContainer = item => { foundation.proofs.set(item.Id, foundation.containerProof(item)); return item }
    foundation.compose = () => { created = true; return { status: 1 } }
    await assert.rejects(foundation.start(['redis'], { onChange: value => { snapshot = value } }), /FOUNDATION_START_FAILED/)
    assert.deepEqual(snapshot.started.map(item => item.id), started ? ['new'] : [])
    assert.deepEqual(snapshot.createdStopped.map(item => item.id), started ? [] : ['new'])
    assert.equal(snapshot.containerProofs.length, 1)
  }
})
function adapter({ missing = false, createdAt = 'original' } = {}) {
  const calls = []
  const runner = (_command, args) => {
    calls.push(args)
    if (args.includes('config')) return { status: 0, stdout: JSON.stringify(configuration) }
    if (args[0] === 'volume') {
      if (args[1] === 'ls') return { status: 0, stdout: missing ? '' : 'fixture_pgdata\nfixture_redisdata' }
      if (missing) return { status: 1, stdout: '' }
      const name = args.at(-1), volume = name.replace('fixture_', '')
      return { status: 0, stdout: JSON.stringify([{ Name: name, CreatedAt: createdAt, Labels: {
        'com.docker.compose.project': 'fixture', 'com.docker.compose.volume': volume } }]) }
    }
    if (args[0] === 'ps') return { status: 0, stdout: '' }
    throw new Error(`Unexpected call: ${args[0]}`)
  }
  return { calls, foundation: new Foundation({ workspace: '.', fingerprint: 'target' }, { runner, project: 'fixture', environment: {} }) }
}
test('missing volumes fail before any compose up/create/migration call', () => {
  const state = adapter({ missing: true })
  assert.throws(() => state.foundation.preflight(), /VOLUME_MISSING/)
  assert.equal(state.calls.filter(args => args.includes('up') || args.includes('run') || args.includes('create')).length, 0)
})
test('partial volume absence is proven globally and target inventory cannot adopt unknown volumes', () => {
  const f = adapter({ missing: true }).foundation
  assert.deepEqual(f.verifyVolumes(false), [])
  const call = f.call.bind(f)
  f.call = (args, allowFailure) => args[0] === 'volume' && args[1] === 'ls' ? { status: 0, stdout: 'fixture_pgdata' } : call(args, allowFailure)
  assert.throws(() => f.verifyVolumes(false), /VOLUME_INSPECTION_FAILED/)
  f.call = (args, allowFailure) => args[0] === 'volume' && args[1] === 'ls' ? { status: 0, stdout: 'unknown_data' } : call(args, allowFailure)
  assert.throws(() => f.verifyVolumeInventory(), /VOLUME_OWNER_UNKNOWN/)
})
test('preflight and start never replace an existing historical proof with a changed current sample', async () => {
  const f = adapter().foundation
  const actual = { Id: 'owned', Image: 'fixture', Mounts: [], HostConfig: {}, State: { Running: false },
    Config: { Labels: { 'com.docker.compose.project': 'fixture', 'com.docker.compose.service': 'redis', 'com.docker.compose.oneoff': 'False' } } }
  const proof = f.containerProof(actual); f.proofs.set(actual.Id, proof)
  actual.HostConfig.Privileged = true; f.containers = () => [actual]
  assert.throws(() => f.preflight(), /OWNERSHIP_CONFLICT/)
  await assert.rejects(f.start(['redis']), /OWNERSHIP_CONFLICT/)
  assert.deepEqual(f.proofs.get(actual.Id), proof)
})
test('same-name recreated volumes fail their prepared CreatedAt identity before any up', () => {
  const original = adapter().foundation.verifyVolumes()
  const replacement = adapter({ createdAt: 'replacement' })
  assert.throws(() => replacement.foundation.preflight(true, original), /VOLUME_IDENTITY_CHANGED/)
  assert.equal(replacement.calls.filter(args => args.includes('up')).length, 0)
})
test('prepared volumes are rechecked rather than trusting state files or names', () => {
  const state = adapter()
  assert.doesNotThrow(() => state.foundation.preflight(true, state.foundation.verifyVolumes()))
  assert.equal(state.calls.filter(args => args[0] === 'volume').length, 4)
})
test('cleanup selects only containers started in the current run and preserves pre-running IDs', async () => {
  const stopped = [], foundation = adapter().foundation
  foundation.preRunning.set('foreign', { id: 'foreign', service: 'redis' })
  foundation.started.set('owned', { id: 'owned', service: 'hydra' })
  foundation.inspect = id => ({ Id: id, State: { Running: !stopped.some(args => args.at(-1) === id) }, Image: 'fixture', Mounts: [], HostConfig: {},
    Config: { Labels: { 'com.docker.compose.project': 'fixture', 'com.docker.compose.service': id === 'foreign' ? 'redis' : 'hydra', 'com.docker.compose.oneoff': 'False' } } })
  foundation.verifyContainer = actual => actual
  foundation.proofs.set('owned', foundation.containerProof(foundation.inspect('owned')))
  foundation.proofs.set('foreign', foundation.containerProof(foundation.inspect('foreign')))
  foundation.containers = () => ['owned', 'foreign'].map(id => foundation.inspect(id))
  foundation.call = args => { stopped.push(args); return { status: 0 } }
  await foundation.stopStarted()
  assert.deepEqual(stopped, [['stop', '--time', '10', 'owned']])
})

test('owned stop acknowledgements cannot hide running, uncertain state or a prior item restarted during a later stop', async () => {
  for (const fault of ['ack-running', 'uncertain', 'earlier-restarted']) {
    const f = adapter().foundation, calls = []
    const actual = new Map(['first', 'second', 'independent'].map(id => [id, { Id: id, Image: 'image', HostConfig: {}, Mounts: [],
      Config: { Labels: { 'com.docker.compose.project': 'fixture', 'com.docker.compose.service': 'redis', 'com.docker.compose.oneoff': 'False' } },
      State: { Running: true, StartedAt: '2026-10-05T00:00:00Z' } }]))
    for (const id of ['first', 'second']) f.started.set(id, { id, service: 'redis' })
    f.preRunning.set('independent', { id: 'independent', service: 'redis' })
    for (const [id, container] of actual) f.proofs.set(id, f.containerProof(container))
    const original = f.snapshot()
    f.inspect = id => actual.get(id); f.containers = () => [...actual.values()]; f.verifyContainer = container => container
    f.call = args => {
      const id = args.at(-1); calls.push(id); actual.get(id).State.Running = false
      if (fault === 'ack-running') actual.get(id).State.Running = true
      if (fault === 'uncertain') delete actual.get(id).State.Running
      if (fault === 'earlier-restarted' && id === 'first') actual.get('second').State.Running = true
      return { status: 0 }
    }
    await assert.rejects(f.stopStarted(), /FOUNDATION_STOP_INCOMPLETE/)
    assert.deepEqual(calls, fault === 'earlier-restarted' ? ['second', 'first'] : ['second'])
    assert.deepEqual(f.snapshot(), original)
    assert.equal(actual.get('independent').State.Running, true)
  }
})

test('container ownership canonicalizes Docker mount ordering and detects every changed mount/config field', () => {
  const foundation = adapter().foundation, container = { Id: 'owned', Image: 'image', Config: { Labels: {
    'com.docker.compose.project': 'fixture', 'com.docker.compose.service': 'server', 'com.docker.compose.oneoff': 'False' } },
    HostConfig: { RestartPolicy: { Name: 'no' } }, Mounts: [{ Destination: '/b', Source: 'second', RW: false }, { Destination: '/a', Source: 'first', RW: true }] }
  const proof = foundation.containerProof(container)
  assert.doesNotThrow(() => foundation.verifyRecordedContainer({ ...container, Mounts: [...container.Mounts].reverse() }, proof))
  for (const changed of [
    { ...container, Mounts: [{ ...container.Mounts[0], Source: 'other' }, container.Mounts[1]] },
    { ...container, Mounts: [{ ...container.Mounts[0], RW: true }, container.Mounts[1]] },
    { ...container, HostConfig: { RestartPolicy: { Name: 'always' } } },
    { ...container, Image: 'other-image' }, { ...container, Config: { ...container.Config, Env: ['OTHER=value'] } },
  ]) assert.throws(() => foundation.verifyRecordedContainer(changed, proof), /OWNERSHIP_CONFLICT/)
})

test('a concurrent Docker configuration change during an owned stop cannot be recorded as trusted', async () => {
  const foundation = adapter().foundation
  let container = { Id: 'owned', Image: 'image', Config: { Labels: {
    'com.docker.compose.project': 'fixture', 'com.docker.compose.service': 'server', 'com.docker.compose.oneoff': 'False' } }, HostConfig: {}, Mounts: [], State: { Running: true } }
  foundation.started.set('owned', { id: 'owned', service: 'server' })
  foundation.proofs.set('owned', foundation.containerProof(container))
  foundation.inspect = () => container; foundation.verifyContainer = actual => actual
  foundation.containers = () => [container]
  foundation.call = () => { container = { ...container, HostConfig: { Privileged: true }, State: { Running: false } } }
  await assert.rejects(foundation.stopStarted(), /OWNERSHIP_CONFLICT/)
  assert.notEqual(foundation.proofs.get('owned').digest, foundation.containerProof(container).digest)
})
test('inspection failure requires successful global exact-ID evidence of true absence, never project labels', () => {
  const id = 'a'.repeat(64), other = 'b'.repeat(64)
  for (const [inventory, expected] of [
    [{ status: 0, stdout: `${id} existing` }, /DOCKER_INSPECTION_FAILED/],
    [{ status: 1, stdout: '' }, /LOCAL_DOCKER_FAILED/],
    [{ status: 0, stdout: 'invalid ID' }, /DOCKER_INVENTORY_INVALID/],
    [{ status: 0, stdout: `${id} one\n${id} two` }, /DOCKER_INVENTORY_INVALID/],
    [{ status: 0, stdout: `${id} same\n${other} same` }, /DOCKER_INVENTORY_INVALID/],
  ]) {
    const calls = [], foundation = new Foundation({ workspace: '.', fingerprint: 'target' }, { project: 'fixture', environment: {},
      runner: (_command, args) => { calls.push(args); return args[0] === 'inspect' ? { status: 1, stdout: '[]' } : inventory } })
    assert.throws(() => foundation.inspect(id), expected)
    assert.deepEqual(calls.at(-1), ['ps', '-a', '--no-trunc', '--format', '{{.ID}} {{.Names}}'])
  }
  const missing = new Foundation({ workspace: '.', fingerprint: 'target' }, { project: 'fixture', environment: {},
    runner: (_command, args) => args[0] === 'inspect' ? { status: 1, stdout: '[]' } : { status: 0, stdout: `${other} other` } })
  assert.equal(missing.inspect(id), null)
  const ambiguous = new Foundation({ workspace: '.', fingerprint: 'target' }, { project: 'fixture', environment: {},
    runner: (_command, args) => args[0] === 'inspect' ? { status: 1, stdout: '[]' } : { status: 0, stdout: `${id} one\n${'a'.repeat(12) + 'c'.repeat(52)} two` } })
  assert.throws(() => ambiguous.inspect('a'.repeat(12)), /DOCKER_INSPECTION_FAILED/)
})
test('managed literal-name absence is proven globally, including pure-hex names and ID-prefix ambiguity', () => {
  const id = 'b'.repeat(64), name = 'exwebsite-verifier-fixture'
  const fixture = inventory => new Foundation({ workspace: '.', fingerprint: 'target' }, { project: 'fixture', environment: {},
    runner: (_command, args) => args[0] === 'inspect' ? { status: 1, stdout: '[]' } : inventory })
  assert.equal(fixture({ status: 0, stdout: `${id} another` }).inspect(name), null)
  assert.throws(() => fixture({ status: 0, stdout: `${id} ${name}` }).inspect(name), /DOCKER_INSPECTION_FAILED/)
  for (const hexName of ['a'.repeat(12), 'a'.repeat(64)])
    assert.throws(() => fixture({ status: 0, stdout: `${id} ${hexName}` }).inspect(hexName), /DOCKER_INSPECTION_FAILED/)
  assert.throws(() => fixture({ status: 0, stdout: `${id} another` }).inspect(id.slice(0, 12)), /DOCKER_INSPECTION_FAILED/)
  assert.throws(() => fixture({ status: 1, stdout: '' }).inspect(name), /LOCAL_DOCKER_FAILED/)
  for (const stdout of [`${id} ${name} extra`, `${id} --option`, undefined])
    assert.throws(() => fixture({ status: 0, stdout }).inspect(name), /DOCKER_INVENTORY_INVALID/)
  for (const invalid of ['--option', 'name*', 'name/part', 'name with spaces'])
    assert.throws(() => fixture({ status: 0, stdout: '' }).inspect(invalid), /DOCKER_INVENTORY_INVALID/)
})
