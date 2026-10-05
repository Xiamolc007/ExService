import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { awaitingGatewayTemplate, legacyInitRecipe, pauseContainers, prepareFullRuntime, bootstrapFull, websiteRuntimeRecipe, fullUpRuntime, fullDownRuntime, transitionStoppedApplications, legacyCommand } from './legacy.mjs'
import { Foundation } from './foundation.mjs'
import { acquireLock } from './ownership.mjs'
import { randomUUID } from 'node:crypto'
import { atomicJson, digest, LocalError, readJson } from './local-config.mjs'

test('legacy final restore observing an owned restart retains the original recovery and lock', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'legacy-final-stop-')), gatewayTemplate = join(directory, 'gateway')
  const resources = { started: [{ id: 'owned', service: 'server' }], preRunning: [{ id: 'independent', service: 'redis' }],
    createdStopped: [], containerProofs: [{ id: 'owned', service: 'server', digest: 'original' }, { id: 'independent', service: 'redis', digest: 'independent' }] }
  const registry = { version: 1, mode: 'dev', runId: randomUUID(), fingerprint: 'fixture', state: 'ready',
    identity: { pid: 987654, creation: 'exited', executable: 'node', commandDigest: 'exited' }, resources, gatewayDigest: digest('fixture') }
  let restores = 0, stops = 0, ownedRunning = true
  const foundation = { restore() { if (++restores === 2) ownedRunning = true }, async stopStarted() { stops++; ownedRunning = false },
    verifyStopped() { if (ownedRunning) throw new LocalError('FOUNDATION_STOP_INCOMPLETE') }, snapshot: () => resources }
  try {
    writeFileSync(gatewayTemplate, 'fixture'); atomicJson(join(directory, 'mode.json'), registry)
    atomicJson(join(directory, 'initialized.json'), { version: 1, secretFingerprint: digest({}), volumes: [] })
    await assert.rejects(legacyCommand('down', 'dev', undefined, { directory, gatewayTemplate, valuesFor: () => ({}), assertHosts: async () => {},
      control: async () => false, runtime: () => ({ mode: 'dev', fingerprint: 'fixture', foundation }) }), /FOUNDATION_STOP_INCOMPLETE/)
    assert.equal(stops, 1); assert.equal(restores, 2); assert.equal(ownedRunning, true)
    const retained = readJson(join(directory, 'mode-lock.json'))
    assert.equal(retained.cleanupRequired, true); assert.deepEqual(retained.recovery.identity, registry.identity)
    assert.deepEqual(retained.resources, resources); assert.equal(readJson(join(directory, 'mode.json')).state, 'stopping')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('awaiting gateway preserves API and internal denial blocks with exact LF and CRLF docs replacements', () => {
  const source = readFileSync('infra/docs-integration/gateway/default.conf.template', 'utf8')
  for (const template of [source.replaceAll('\r\n', '\n'), source.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n')]) {
    const actual = awaitingGatewayTemplate(template)
    for (const path of ['/api/internal/', '/docs/internal/']) assert.ok(actual.includes(`  location ^~ ${path} { return 404; }`))
    assert.ok(actual.includes('  location ^~ /api/ {'))
    assert.ok(actual.includes('    proxy_pass http://${WEBSITE_SERVER_UPSTREAM};'))
    for (const path of ['/docs/static/', '/docs/']) assert.ok(actual.includes(`  location ^~ ${path} { return 503; }`))
    assert.equal(actual.includes('${OUTLINE_'), false)
    assert.ok(actual.includes('    proxy_pass http://${WEBSITE_WEB_UPSTREAM};'))
    assert.ok(actual.includes('    proxy_pass http://hydra:4444;'))
  }
  assert.throws(() => awaitingGatewayTemplate(source.replace('location ^~ /docs/ {', 'location ^~ /new-docs/ {')), /TEMPLATE_CHANGED/)
  assert.throws(() => awaitingGatewayTemplate(source + '\n  location ^~ /docs/ {\n  }'), /TEMPLATE_CHANGED/)
})
test('full recipe preserves the frozen local ExUI links through one exact build-only anchor', () => {
  const source = readFileSync('Dockerfile', 'utf8'), recipe = websiteRuntimeRecipe(source)
  assert.equal(recipe.replace('\nRUN ln -s /workspace/website/vendor/exui /exui', ''), source)
  assert.equal(recipe.split('RUN ln -s /workspace/website/vendor/exui /exui').length, 2)
  assert.throws(() => websiteRuntimeRecipe(source + '\nCOPY --from=exui . vendor/exui'), /ANCHOR_CHANGED/)
  assert.throws(() => websiteRuntimeRecipe(source.replace('COPY --from=exui . vendor/exui', 'COPY new-layout vendor/exui')), /ANCHOR_CHANGED/)
  assert.throws(() => websiteRuntimeRecipe(recipe), /ANCHOR_CHANGED/)
})
test('legacy initializer runtime recipe changes only CRLF and rejects malformed shell headers', () => {
  const source = readFileSync('infra/docs-integration/postgres/init.sh', 'utf8')
  const recipe = legacyInitRecipe(source)
  assert.equal(recipe, source.replaceAll('\r\n', '\n'))
  assert.equal(recipe.includes('\r'), false)
  assert.throws(() => legacyInitRecipe(source.replace('#!/bin/sh', '#!/bin/other')), /SOURCE_INVALID/)
  assert.throws(() => legacyInitRecipe(source + '\r'), /SOURCE_INVALID/)
})
test('persistent full awaiting owner pauses its whole group, retries failure and clears a partial resume', async () => {
  const containers = ['server', 'web', 'outline', 'gateway', 'postgres'].map(service => ({
    Id: service, State: { Running: service !== 'outline' }, Config: { Labels: { 'com.docker.compose.service': service } },
  }))
  const registry = containers.filter(item => item.Id !== 'postgres').map(item => ({ id: item.Id, service: item.Id }))
  const foundation = { containers: () => containers, inspect: id => containers.find(item => item.Id === id), verifyContainer() {},
    proofs: new Map(registry.map(item => [item.id, { ...item }])), verifyRecordedContainer() {},
    started: new Map(registry.map(item => [item.id, item])), call(args) { containers.find(item => item.Id === args.at(-1)).State.Running = false },
    async start(services, { onChange }) { for (const service of services) containers.find(item => item.Id === service).State.Running = true; onChange({ started: registry, preRunning: [{ id: 'postgres', service: 'postgres' }] }) } }
  const lock = { record: { persistent: true, identity: { pid: 987654 }, state: 'awaiting-bootstrap', managedApplications: registry },
    update(value) { Object.assign(this.record, value) } }
  const state = { foundation }, options = { gatewayDigest: () => 'fixture-gateway', ready: async () => {} }
  const paused = () => containers.filter(item => item.Id !== 'postgres').every(item => !item.State.Running)
  await assert.rejects(prepareFullRuntime(state, lock, 'explicit-fixture-uuid', { ...options, prepare: async () => { assert.equal(paused(), true); throw new Error('prepare failure') } }), /prepare failure/)
  assert.equal(paused(), true); assert.equal(lock.record.state, 'preparation-failed')
  await prepareFullRuntime(state, lock, 'explicit-fixture-uuid', { ...options, prepare: async () => { assert.equal(paused(), true) } })
  assert.equal(lock.record.state, 'ready'); assert.equal(containers.every(item => item.State.Running), true)
  await assert.rejects(prepareFullRuntime(state, lock, 'explicit-fixture-uuid', { ...options, prepare: async () => {}, ready: async () => { throw new Error('resume readiness failure') } }), /resume readiness failure/)
  assert.equal(paused(), true); assert.equal(containers.at(-1).State.Running, true)
  assert.equal(lock.record.state, 'preparation-failed')
})
test('full pause proves every application before mutation and preserves independent foundation', async () => {
  const events = [], containers = ['server', 'web', 'outline', 'gateway', 'postgres'].map(service => ({
    Id: service, State: { Running: true }, Config: { Labels: { 'com.docker.compose.service': service } },
  }))
  let invalid
  const foundation = { containers: () => containers, inspect: id => containers.find(item => item.Id === id),
    proofs: new Map(containers.map(item => [item.Id, { id: item.Id, service: item.Id }])), verifyRecordedContainer() {},
    verifyContainer(actual) { if (actual.Id === invalid) throw new Error('changed configuration') },
    call(args) { events.push(args.at(-1)); containers.find(item => item.Id === args.at(-1)).State.Running = false } }
  const registry = containers.filter(item => item.Id !== 'postgres').map(item => ({ id: item.Id, service: item.Id }))
  invalid = 'gateway'
  await assert.rejects(pauseContainers({ foundation }, registry), /changed configuration/)
  assert.deepEqual(events, [])
  invalid = undefined
  await assert.rejects(pauseContainers({ foundation }, registry.slice(0, 3)), /OWNER_UNKNOWN/)
  assert.deepEqual(events, [])
  await pauseContainers({ foundation }, registry)
  assert.deepEqual(events, ['gateway', 'outline', 'web', 'server'])
  assert.equal(containers.at(-1).State.Running, true)
})

function fullOwnerFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'full-owner-')), modeRecordPath = join(directory, 'mode.json'), containers = new Map(), calls = []
  const state = { workspace: '.', fingerprint: 'fixture', mode: 'full' }, volumes = [{ name: 'fixture-volume', createdAt: 'original', labels: {} }]
  const add = (service, running = false) => {
    const container = { Id: `fixture-${service}`, Image: 'fixture-image', Config: { Labels: {
      'com.docker.compose.project': 'fixture', 'com.docker.compose.service': service, 'com.docker.compose.oneoff': 'False' } }, HostConfig: {}, Mounts: [], State: { Running: running, StartedAt: running ? '2026-01-01T00:00:00Z' : '0001-01-01T00:00:00Z' } }
    containers.set(container.Id, container); return container
  }
  const make = () => {
    const foundation = new Foundation(state, { project: 'fixture', environment: {} })
    foundation.verifyVolumes = () => volumes
    foundation.verifyVolumeInventory = () => {}
    foundation.containers = () => [...containers.values()]; foundation.inspect = id => containers.get(id)
    foundation.verifyContainer = container => { foundation.proofs.set(container.Id, foundation.containerProof(container)); return container }
    foundation.call = args => {
      calls.push(args)
      if (foundation.failStop) throw new Error('stop failed')
      if (args[0] === 'rm') { containers.delete(args.at(-1)); return }
      const container = containers.get(args.at(-1)); container.State.Running = false
      if (foundation.changeDuringStop) container.HostConfig = { Privileged: true }
    }
    foundation.start = async (services, { onChange = () => {} } = {}) => {
      for (const service of services) {
        if (service === foundation.failStart) throw new Error('partial start failed')
        const container = containers.get(`fixture-${service}`) ?? add(service)
        if (container.State.Running && !foundation.started.has(container.Id)) foundation.preRunning.set(container.Id, { id: container.Id, service })
        container.State.Running = true; container.State.StartedAt = '2026-01-01T00:00:00Z'; foundation.verifyContainer(container)
        if (!foundation.preRunning.has(container.Id)) foundation.started.set(container.Id, { id: container.Id, service })
        onChange(foundation.snapshot())
      }
    }
    return foundation
  }
  add('postgres', true); add('redis', true)
  state.foundation = make()
  const inspect = pid => ({ pid, creation: 'fixture', executable: 'fixture-node', commandDigest: 'fixture-command' })
  const owner = () => acquireLock({ mode: 'full', fingerprint: state.fingerprint, directory, inspect })
  const options = { modeRecordPath, build: async () => {}, check: async () => {}, gatewayDigest: () => 'fixture-gateway', ready: async () => {} }
  return { state, directory, modeRecordPath, containers, add, make, owner, volumes, options, calls,
    close() { rmSync(directory, { recursive: true, force: true }) } }
}

test('full preparation refuses a successful stop acknowledgement with a running exact owned application', async () => {
  for (const phase of ['initial', 'unknown-state', 'failed-resume', 'earlier-restarted']) {
    const fixture = fullOwnerFixture(), lock = fixture.owner()
    let prepared = 0, stops = 0, fault = phase !== 'failed-resume'
    try {
      await fixture.state.foundation.start(['server', 'web', 'outline', 'gateway'])
      const registry = [...fixture.state.foundation.started.values()], resources = fixture.state.foundation.snapshot()
      lock.update({ persistent: true, state: 'ready', managedApplications: registry, resources })
      const call = fixture.state.foundation.call
      fixture.state.foundation.call = args => {
        call(args)
        if (args[0] !== 'stop') return
        stops++
        if (fault && phase !== 'earlier-restarted') fixture.containers.get(args.at(-1)).State.Running = phase === 'unknown-state' ? undefined : true
        if (fault && phase === 'earlier-restarted' && stops === registry.length) fixture.containers.get('fixture-gateway').State.Running = true
      }
      await assert.rejects(prepareFullRuntime(fixture.state, lock, 'explicit-fixture-uuid', {
        gatewayDigest: () => 'fixture-gateway', prepare: async () => { prepared++ },
        ready: async () => { fault = true; throw new Error('resume failed') },
      }), /FULL_APPLICATION_STOP_INCOMPLETE/)
      assert.equal(prepared, phase === 'failed-resume' ? 1 : 0)
      assert.equal(lock.record.cleanupRequired, true); assert.equal(lock.record.state, 'cleanup-failed')
      assert.equal(existsSync(lock.path), true)
      assert.deepEqual(lock.record.resources.containerProofs, resources.containerProofs)
      assert.equal(fixture.containers.get('fixture-postgres').State.Running, true)
      assert.equal(fixture.containers.get('fixture-redis').State.Running, true)
    } finally { fixture.close() }
  }
})

test('early legacy dev and preparation cleanup failures retain durable intent before a new mode can acquire', async () => {
  for (const command of ['dev', 'init', 'migrate']) {
    const fixture = fullOwnerFixture(), gatewayTemplate = join(fixture.directory, 'gateway')
    const foundation = fixture.state.foundation
    fixture.containers.get('fixture-postgres').State.Running = false
    foundation.compose = () => { throw new LocalError('ORIGINAL_PREPARATION_FAILURE') }
    foundation.failStop = true
    writeFileSync(gatewayTemplate, 'fixture-gateway')
    const context = { directory: fixture.directory, gatewayTemplate, valuesFor: () => ({}), assertHosts: async () => {}, externalCheck: () => {},
      runtime: () => fixture.state, initialized: () => ({ volumes: fixture.volumes }),
      dev: { tools: {}, assertPorts: async () => {}, writeGateway: () => {}, checkPrepared: async () => { throw new LocalError('ORIGINAL_PREPARATION_FAILURE') } } }
    try {
      await assert.rejects(legacyCommand(command, 'dev', undefined, context), /ORIGINAL_PREPARATION_FAILURE/)
      const retained = readJson(join(fixture.directory, 'mode-lock.json'))
      assert.equal(retained.cleanupRequired, true); assert.equal(retained.state, 'cleanup-failed')
      assert.ok(retained.resources.started.some(item => item.service === 'postgres'))
      assert.deepEqual(retained.preparedVolumes, fixture.volumes)
      assert.equal(readJson(fixture.modeRecordPath).cleanupRequired, true)
      for (const mode of ['dev', 'full']) assert.throws(() => acquireLock({ mode, fingerprint: 'fixture', directory: fixture.directory,
        inspect: pid => ({ pid, creation: 'next-process', executable: 'next-node', commandDigest: 'next-command' }), externalCheck: () => {} }), /MODE_CLEANUP_REQUIRED/)
      if (command !== 'dev') {
        assert.equal(existsSync(join(fixture.directory, 'initialized.json')), false)
        assert.equal(retained.preparation.command, command)
        assert.equal(retained.preparation.secretFingerprint, digest({}))
      }
    } finally { fixture.close() }
  }
})

test('default build-only full bootstrap retains the original temporary proof when stop acknowledges a still running oneoff', async () => {
  const fixture = fullOwnerFixture(), lock = fixture.owner(), foundation = fixture.state.foundation
  let temporary, stopCalls = 0
  try {
    foundation.preflight()
    await foundation.start(['server', 'web', 'outline', 'gateway'])
    await foundation.stopStarted()
    lock.update({ preparedVolumes: fixture.volumes, resources: foundation.snapshot() })
    foundation.configuration = () => ({ services: { server: { build: { context: 'fixture' } } } })
    foundation.compose = args => {
      if (args.includes('-d')) {
        temporary = fixture.add('temporary', true)
        temporary.Config.Image = 'fixture-image'
        Object.assign(temporary.Config.Labels, { 'dev.exwebsite.run': lock.record.runId,
          'com.docker.compose.service': 'server', 'com.docker.compose.oneoff': 'True' })
      }
      return { status: 0, stdout: temporary?.Id ?? '' }
    }
    foundation.call = args => {
      if (args[0] === 'cp') throw new Error('fixture bootstrap interrupted')
      assert.equal(args[0], 'stop'); stopCalls++
      temporary.State.Running = false; temporary.State.Running = true
      return { status: 0, stdout: '' }
    }
    await assert.rejects(bootstrapFull(fixture.state, lock, 'explicit-user'), /TEMPORARY_CONTAINER_STOP_INCOMPLETE/)
    assert.equal(stopCalls, 1); assert.equal(temporary.State.Running, true)
    assert.equal(lock.record.temporaryContainer, temporary.Id)
    assert.deepEqual(lock.record.temporaryProof, foundation.containerProof(temporary))
    assert.equal(readJson(lock.path).temporaryContainer, temporary.Id)
    assert.equal(fixture.containers.get('fixture-postgres').State.Running, true)
  } finally { fixture.close() }
})

test('temporary creation failures retain precreate image authority without adopting a later sample', async () => {
  for (const fault of ['first-reference-write', 'first-inspect', 'wrong-image']) {
    const fixture = fullOwnerFixture(), lock = fixture.owner(), foundation = fixture.state.foundation
    let temporary, name, stops = 0
    try {
      foundation.preflight(); await foundation.start(['server', 'web', 'outline', 'gateway']); await foundation.stopStarted()
      lock.update({ persistent: true, preparedVolumes: fixture.volumes, resources: foundation.snapshot(), gatewayDigest: digest('fixture-gateway') })
      const inspect = foundation.inspect
      foundation.inspect = id => {
        if (temporary && (id === temporary.Id || id === name)) {
          if (fault === 'first-inspect') throw new LocalError('DOCKER_INSPECTION_FAILED')
          return temporary
        }
        return inspect(id)
      }
      foundation.compose = args => {
        if (args.includes('-d')) {
          name = args[args.indexOf('--name') + 1]
          temporary = fixture.add('temporary', true)
          temporary.Config.Image = 'fixture-default-built-server'
          if (fault === 'wrong-image') temporary.Image = 'unexpected-build'
          Object.assign(temporary.Config.Labels, { 'dev.exwebsite.run': lock.record.runId,
            'com.docker.compose.service': 'server', 'com.docker.compose.oneoff': 'True' })
        }
        return { status: 0, stdout: temporary?.Id ?? '' }
      }
      foundation.call = args => { if (args[0] === 'stop') stops++; throw new Error('unexpected mutation') }
      const update = lock.update
      lock.update = extra => {
        if (fault === 'first-reference-write' && extra.temporaryContainer) throw new Error('reference write failed')
        update(extra)
      }
      await assert.rejects(bootstrapFull(fixture.state, lock, 'explicit-fixture-user'))
      const durable = readJson(lock.path)
      assert.equal(temporary.State.Running, true); assert.equal(stops, 0)
      assert.equal(durable.temporaryName, name); assert.equal(durable.temporaryExpectedImage, 'fixture-image')
      assert.equal(durable.temporarySourceId, 'fixture-server'); assert.equal(durable.cleanupRequired, true)
      if (fault === 'first-reference-write') assert.equal(durable.temporaryContainer, undefined)
      else assert.equal(durable.temporaryContainer, temporary.Id)
      if (fault === 'wrong-image') assert.deepEqual(durable.temporaryProof, foundation.containerProof(temporary))
      else assert.equal(durable.temporaryProof, undefined)
      // A fresh explicit down cannot turn the now-readable container into a
      // missing historical proof, nor use the wrong image's new proof to stop it.
      foundation.inspect = id => id === name ? temporary : inspect(id)
      const gatewayTemplate = join(fixture.directory, 'gateway')
      writeFileSync(gatewayTemplate, 'fixture-gateway')
      atomicJson(join(fixture.directory, 'initialized.json'), { version: 1, secretFingerprint: digest({}), volumes: fixture.volumes })
      await assert.rejects(legacyCommand('down', 'full', undefined, { directory: fixture.directory, gatewayTemplate,
        runtime: () => fixture.state, valuesFor: () => ({}), assertHosts: async () => {}, control: async () => false,
      }), /TEMPORARY_CONTAINER_(PROOF_MISSING|IDENTITY_INVALID)/)
      assert.equal(stops, 0); assert.equal(readJson(lock.path).cleanupRequired, true)
    } finally { fixture.close() }
  }
})

test('full preparation retains cleanup intent when a stopped temporary container cannot be removed', async () => {
  const fixture = fullOwnerFixture(), lock = fixture.owner(), foundation = fixture.state.foundation
  let temporary, name
  try {
    foundation.preflight()
    await foundation.start(['server', 'web', 'outline', 'gateway'])
    lock.update({ persistent: true, preparedVolumes: fixture.volumes, resources: foundation.snapshot(),
      managedApplications: [...foundation.started.values()] })
    const inspect = foundation.inspect, call = foundation.call
    foundation.inspect = id => id === name ? temporary : inspect(id)
    foundation.compose = args => {
      if (args.includes('-d')) {
        name = args[args.indexOf('--name') + 1]; temporary = fixture.add('temporary', true)
        Object.assign(temporary.Config.Labels, { 'dev.exwebsite.run': lock.record.runId,
          'com.docker.compose.service': 'server', 'com.docker.compose.oneoff': 'True' })
      }
      return { status: 0, stdout: temporary?.Id ?? '' }
    }
    foundation.call = args => {
      if (args[0] === 'cp') throw new Error('fixture bootstrap interrupted')
      if (args[0] === 'rm') throw new Error('temporary removal failed')
      return call(args)
    }
    await assert.rejects(prepareFullRuntime(fixture.state, lock, 'explicit-user', {
      gatewayDigest: () => 'fixture-gateway',
    }), /temporary removal failed/)
    assert.equal(temporary.State.Running, false)
    const retained = readJson(lock.path)
    assert.equal(retained.cleanupRequired, true); assert.equal(retained.state, 'cleanup-failed')
    assert.equal(retained.temporaryContainer, temporary.Id); assert.equal(retained.temporaryName, name)
    assert.deepEqual(retained.temporaryProof, foundation.containerProof(temporary))
    assert.equal(retained.temporaryExpectedImage, 'fixture-image')
    assert.equal(fixture.containers.get('fixture-postgres').State.Running, true)
  } finally { fixture.close() }
})

test('early cleanup cannot release after its stopped journal write fails', async () => {
  const fixture = fullOwnerFixture(), gatewayTemplate = join(fixture.directory, 'gateway')
  fixture.containers.get('fixture-postgres').State.Running = false
  writeFileSync(gatewayTemplate, 'fixture-gateway')
  try {
    await assert.rejects(legacyCommand('dev', 'dev', undefined, { directory: fixture.directory, gatewayTemplate,
      runtime: () => fixture.state, valuesFor: () => ({}), assertHosts: async () => {}, externalCheck: () => {},
      initialized: () => ({ volumes: fixture.volumes }), persist: (path, value) => {
        if (value.state === 'stopped') throw new Error('stopped journal failed')
        atomicJson(path, value)
      }, dev: { tools: {}, assertPorts: async () => {}, writeGateway: () => {}, checkPrepared: async () => { throw new Error('original readiness failure') } },
    }), /original readiness failure/)
    const retained = readJson(join(fixture.directory, 'mode-lock.json'))
    assert.equal(retained.cleanupRequired, true); assert.equal(retained.state, 'cleanup-failed')
    assert.equal(readJson(fixture.modeRecordPath).state, 'cleanup-failed')
    assert.equal(fixture.containers.get('fixture-postgres').State.Running, false)
  } finally { fixture.close() }
})

test('partial preparation never replaces a previously persisted volume identity with a current sample', async () => {
  const fixture = fullOwnerFixture(), foundation = fixture.state.foundation, gatewayTemplate = join(fixture.directory, 'gateway')
  fixture.containers.get('fixture-postgres').State.Running = false
  let volumes = fixture.volumes
  foundation.verifyVolumes = () => volumes
  foundation.compose = () => { throw new LocalError('ORIGINAL_PREPARATION_FAILURE') }
  foundation.failStop = true
  const start = foundation.start
  foundation.start = (services, { onChange }) => start(services, { onChange: resources => {
    volumes = fixture.volumes.map(volume => ({ ...volume, createdAt: 'external replacement' }))
    onChange(resources)
  } })
  writeFileSync(gatewayTemplate, 'fixture-gateway')
  try {
    await assert.rejects(legacyCommand('init', 'dev', undefined, { directory: fixture.directory, gatewayTemplate,
      valuesFor: () => ({}), assertHosts: async () => {}, externalCheck: () => {}, runtime: () => fixture.state,
    }))
    const retained = readJson(join(fixture.directory, 'mode-lock.json'))
    assert.equal(retained.cleanupRequired, true)
    assert.deepEqual(retained.preparedVolumes, fixture.volumes)
    assert.ok(retained.resources.started.some(item => item.service === 'postgres'))
    assert.equal(existsSync(join(fixture.directory, 'initialized.json')), false)
  } finally { fixture.close() }
})
test('first full-up failure saves stopped exact ownership before release, then retry and down work', async () => {
  const fixture = fullOwnerFixture(), lock = fixture.owner(), release = lock.release
  lock.release = () => {
    assert.equal(existsSync(lock.path), true)
    const stopped = JSON.parse(readFileSync(fixture.modeRecordPath, 'utf8'))
    assert.equal(stopped.runId, lock.record.runId); assert.equal(stopped.fingerprint, 'fixture'); assert.ok(stopped.stoppedAt)
    assert.equal(stopped.resources.started.length, 4)
    for (const proof of stopped.resources.containerProofs) fixture.state.foundation.verifyRecordedContainer(fixture.containers.get(proof.id), proof)
    assert.equal(stopped.resources.started.every(item => !fixture.containers.get(item.id).State.Running), true)
    release()
  }
  try {
    assert.equal(existsSync(fixture.modeRecordPath), false)
    await assert.rejects(fullUpRuntime(fixture.state, lock, { volumes: fixture.volumes }, { ...fixture.options, ready: async () => { throw new Error('readiness failed') } }), /readiness failed/)
    assert.equal(existsSync(lock.path), false)
    assert.equal(fixture.containers.get('fixture-postgres').State.Running, true)
    assert.equal(fixture.containers.get('fixture-redis').State.Running, true)
    const stopped = JSON.parse(readFileSync(fixture.modeRecordPath, 'utf8'))
    const calls = fixture.calls.length
    await fullDownRuntime(fixture.state, stopped, fixture.volumes, { modeRecordPath: fixture.modeRecordPath })
    assert.equal(fixture.calls.length, calls)
    fixture.state.foundation = fixture.make(); const retry = fixture.owner()
    await fullUpRuntime(fixture.state, retry, { volumes: fixture.volumes }, fixture.options)
    assert.equal(retry.record.persistent, true)
    await fullDownRuntime(fixture.state, retry.record, fixture.volumes, { modeRecordPath: fixture.modeRecordPath })
    assert.equal(JSON.parse(readFileSync(fixture.modeRecordPath, 'utf8')).state, 'stopped')
    retry.release()
  } finally { fixture.close() }
})
test('partial full-up failure preserves proven old stopped applications not restarted by the new run', async () => {
  const fixture = fullOwnerFixture()
  try {
    const old = ['server', 'web', 'outline', 'gateway'].map(service => fixture.add(service))
    const prior = { mode: 'full', state: 'stopped', stoppedAt: 'old', resources: { preRunning: [],
      started: old.map(container => ({ id: container.Id, service: container.Config.Labels['com.docker.compose.service'] })),
      containerProofs: old.map(container => fixture.state.foundation.containerProof(container)) } }
    writeFileSync(fixture.modeRecordPath, JSON.stringify(prior))
    fixture.state.foundation.failStart = 'web'
    const lock = fixture.owner()
    await assert.rejects(fullUpRuntime(fixture.state, lock, { volumes: fixture.volumes }, fixture.options), /partial start failed/)
    const stopped = JSON.parse(readFileSync(fixture.modeRecordPath, 'utf8'))
    assert.deepEqual(stopped.managedApplications.map(item => item.service).sort(), ['gateway', 'outline', 'server', 'web'])
    assert.deepEqual(stopped.resources.containerProofs.map(item => item.id).sort(),
      [...stopped.resources.started, ...stopped.resources.preRunning].map(item => item.id).sort())
    assert.equal(existsSync(lock.path), false)
  } finally { fixture.close() }
})
test('failed newly created applications have separate recovery proofs and only these exact never-started IDs retire', async () => {
  const fixture = fullOwnerFixture(), lock = fixture.owner(), start = fixture.state.foundation.start
  try {
    fixture.state.foundation.start = async (services, options) => {
      if (services.includes('web')) { fixture.state.foundation.verifyContainer(fixture.add('web')); throw new Error('created without start') }
      return start(services, options)
    }
    await assert.rejects(fullUpRuntime(fixture.state, lock, { volumes: fixture.volumes }, fixture.options), /created without start/)
    const record = JSON.parse(readFileSync(fixture.modeRecordPath, 'utf8'))
    assert.deepEqual(record.resources.createdStopped, [{ id: 'fixture-web', service: 'web' }])
    assert.equal(record.resources.started.some(item => item.id === 'fixture-web'), false)
    assert.equal(fixture.calls.some(args => args.at(-1) === 'fixture-web'), false)
    const web = fixture.containers.get('fixture-web'), before = fixture.calls.length
    web.State.StartedAt = '2026-01-01T00:00:00Z'
    assert.throws(() => transitionStoppedApplications(fixture.state, record, fixture.volumes), /CREATED_APPLICATION_STARTED/)
    assert.equal(fixture.calls.length, before)
    web.State.StartedAt = '0001-01-01T00:00:00Z'; web.HostConfig = { Privileged: true }
    assert.throws(() => transitionStoppedApplications(fixture.state, record, fixture.volumes), /OWNERSHIP_CONFLICT/)
    assert.equal(fixture.calls.length, before)
    web.HostConfig = {}
    assert.deepEqual(transitionStoppedApplications(fixture.state, record, fixture.volumes), ['fixture-web'])
    assert.deepEqual(fixture.calls.at(-1), ['rm', 'fixture-web'])
    assert.equal(fixture.containers.has('fixture-server'), true)
    assert.equal(fixture.containers.get('fixture-postgres').State.Running, true)
  } finally { fixture.close() }
})
test('a new application exiting before the running sample keeps actual-start ownership without forced retirement', async () => {
  const fixture = fullOwnerFixture(), lock = fixture.owner(), start = fixture.state.foundation.start
  try {
    fixture.state.foundation.start = async (services, options) => {
      if (services.includes('server')) {
        const server = fixture.add('server'); server.State.StartedAt = '2026-01-01T00:00:00Z'; server.State.ExitCode = 7
        fixture.state.foundation.verifyContainer(server); throw new Error('exited 7')
      }
      return start(services, options)
    }
    await assert.rejects(fullUpRuntime(fixture.state, lock, { volumes: fixture.volumes }, fixture.options), /exited 7/)
    const record = JSON.parse(readFileSync(fixture.modeRecordPath, 'utf8'))
    assert.equal(record.resources.started.some(item => item.id === 'fixture-server'), true)
    assert.deepEqual(record.resources.createdStopped, [])
    assert.equal(existsSync(lock.path), false)
    assert.equal(fixture.calls.some(args => args.at(-1) === 'fixture-server'), false)
    assert.deepEqual(transitionStoppedApplications(fixture.state, record, fixture.volumes), [])
    await fullDownRuntime(fixture.state, record, fixture.volumes, { modeRecordPath: fixture.modeRecordPath })
    assert.equal(fixture.calls.some(args => args.at(-1) === 'fixture-server'), false)
  } finally { fixture.close() }
})
test('full-up cleanup or exact proof failure retains the real mode lock without a fake stopped record', async () => {
  for (const failure of ['failStop', 'changeDuringStop']) {
    const fixture = fullOwnerFixture(), lock = fixture.owner()
    try {
      fixture.state.foundation[failure] = true
      await assert.rejects(fullUpRuntime(fixture.state, lock, { volumes: fixture.volumes }, { ...fixture.options, ready: async () => { throw new Error('readiness failed') } }), /stop failed|OWNERSHIP_CONFLICT/)
      assert.equal(existsSync(lock.path), true); assert.equal(existsSync(fixture.modeRecordPath), false)
      const journal = JSON.parse(readFileSync(lock.path, 'utf8'))
      assert.equal(journal.state, 'cleanup-failed'); assert.equal(journal.stoppedAt, undefined)
    } finally { fixture.close() }
  }
})
test('stopped full down refuses unknown, tampered and restarted applications or replaced volumes without mutations', async () => {
  for (const failure of ['unknown', 'tamper', 'running', 'volume']) {
    const fixture = fullOwnerFixture(), lock = fixture.owner()
    try {
      await assert.rejects(fullUpRuntime(fixture.state, lock, { volumes: fixture.volumes }, { ...fixture.options, ready: async () => { throw new Error('readiness failed') } }), /readiness failed/)
      const prior = JSON.parse(readFileSync(fixture.modeRecordPath, 'utf8')), before = readFileSync(fixture.modeRecordPath, 'utf8'), calls = fixture.calls.length
      const server = fixture.containers.get('fixture-server')
      if (failure === 'unknown') { const unknown = fixture.add('outline'); assert.equal(prior.resources.started.some(item => item.id === unknown.Id), false) }
      if (failure === 'tamper') server.HostConfig = { Privileged: true }
      if (failure === 'running') server.State.Running = true
      if (failure === 'volume') fixture.volumes[0].createdAt = 'replacement'
      await assert.rejects(fullDownRuntime(fixture.state, prior, failure === 'volume' ? [{ name: 'fixture-volume', createdAt: 'original', labels: {} }] : fixture.volumes,
        { modeRecordPath: fixture.modeRecordPath }), /OWNER_UNKNOWN|OWNERSHIP_CONFLICT|RESTARTED|VOLUME_IDENTITY_CHANGED/)
      assert.equal(fixture.calls.length, calls); assert.equal(readFileSync(fixture.modeRecordPath, 'utf8'), before)
    } finally { fixture.close() }
  }
})

test('full-up never claims a same-configuration foreign application appearing before its service attempt', async () => {
  for (const running of [false, true]) {
    const fixture = fullOwnerFixture(), lock = fixture.owner()
    try {
      await assert.rejects(fullUpRuntime(fixture.state, lock, { volumes: fixture.volumes }, { ...fixture.options,
        build: async () => { fixture.add('server', running) } }), /OWNER_UNKNOWN/)
      assert.equal(existsSync(lock.path), true); assert.equal(existsSync(fixture.modeRecordPath), false)
      assert.equal(fixture.containers.get('fixture-server').State.Running, running)
      assert.equal(fixture.calls.some(args => args.at(-1) === 'fixture-server'), false)
      assert.equal(lock.record.resources.started.some(item => item.id === 'fixture-server'), false)
    } finally { fixture.close() }
  }
})
