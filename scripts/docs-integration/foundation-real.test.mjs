import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { randomBytes, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { root } from './configure.mjs'
import { defaults, digest, secretNames, toolchain, atomicJson, readJson } from './local-config.mjs'
import { Foundation } from './foundation.mjs'
import { cliSpecification, foundationReady, verifyFoundationSchemas, downLocal, preparationJournal, savePrepared, preparedState, controlRequest } from './local-dev.mjs'
import { redact, runOwned, acquireLock, spawnOwned, stopOwned, processIdentity, identityAlive } from './ownership.mjs'

test('active production local control waits for real owned processes then cleans historical foundations with fresh recovery', { timeout: 650000 }, async () => {
  for (const independentRedis of [false, true]) {
    const directory = mkdtempSync(join(tmpdir(), 'local-active-real-')), locks = join(directory, 'locks')
    const project = `exwebsite-local-test-${randomUUID().slice(0, 8)}`, ports = { ...defaults }, used = new Set()
    for (const name of Object.keys(ports)) { do { ports[name] = await freePort() } while (used.has(ports[name])); used.add(ports[name]) }
    const secrets = Object.fromEntries(secretNames.map(key => [key, randomBytes(32).toString('hex')]))
    const config = { ports, publicOrigin: `http://127.0.0.1:${ports.public}`, issuer: `http://127.0.0.1:${ports.hydraPublic}/`,
      clientId: 'ex-outline-local', callback: `http://127.0.0.1:${ports.public}/docs/auth/oidc.callback`, storage: join(directory, 'outline') }
    const state = { config, secrets, directory, workspace: root, website: {}, fingerprint: digest({ config, secrets }) }
    const factory = options => new Foundation(state, { project, ...options }), base = factory()
    const beforeContainers = base.call(['ps', '-a', '--format', '{{.ID}} {{.Names}} {{.State}}']).stdout.trim().split(/\r?\n/).filter(Boolean)
    const moduleUrl = name => pathToFileURL(join(root, 'scripts/docs-integration', name)).href
    const stateFile = join(directory, 'state.json'), childFile = join(directory, 'runtime.mjs'), appFile = join(directory, 'app.mjs')
    const pidFile = join(directory, 'app-pid.json'), checkpoints = [], logs = []
    atomicJson(stateFile, state)
    writeFileSync(appFile, `import{writeFileSync}from'node:fs';writeFileSync(process.argv[2],JSON.stringify(process.pid));setInterval(()=>{},1000)`)
    writeFileSync(childFile, `import{readJson,atomicJson}from ${JSON.stringify(moduleUrl('local-config.mjs'))};
import{Foundation}from ${JSON.stringify(moduleUrl('foundation.mjs'))};import{acquireLock}from ${JSON.stringify(moduleUrl('ownership.mjs'))};
import{supervise,foundationReady,downLocal}from ${JSON.stringify(moduleUrl('local-dev.mjs'))};import{join}from'node:path';import{spawnSync}from'node:child_process';import{setTimeout as delay}from'node:timers/promises';
const state=readJson(process.argv[2]),mode=process.argv[3];let stopCalls=0;const restarted=[];const foundation=new Foundation(state,{project:${JSON.stringify(project)},runner:(cmd,args,opts)=>{
if(args[0]==='stop'){stopCalls++;if(mode==='fail-down')return{status:1,stdout:'',stderr:'disposable post-control stop failure'}}
const result=spawnSync(cmd,args,opts);if(mode==='restart-down'&&args[0]==='stop'&&result.status===0){const id=args.at(-1),again=spawnSync(cmd,['start',id],opts);if(again.status!==0)throw Error('fixture external restart failed');restarted.push(id)}return result}});
try{if(mode!=='supervise'){await downLocal({state,foundation,directory:join(state.directory,'locks'),externalCheck:()=>{}})}
else{const lock=acquireLock({mode:'local',fingerprint:state.fingerprint,directory:join(state.directory,'locks')});
foundation.preflight(true,readJson(join(state.directory,'prepared.json')).volumes);
await foundation.start(['postgres','redis','hydra'],{onChange:resources=>lock.update({resources})});
await supervise({mode:'local',fingerprint:state.fingerprint,directory:state.directory,controlDirectory:join(state.directory,'locks'),lock,foundation,
specifications:[{name:'application',command:process.execPath,args:[${JSON.stringify(appFile)},${JSON.stringify(pidFile)}],cwd:state.workspace,environment:process.env}],
readiness:async()=>foundationReady(state,foundation),banner:'ACTIVE_DISPOSABLE_READY'});await delay(1500);}
console.log('ACTIVE_DISPOSABLE_COMPLETE');process.exitCode=0}catch(error){console.log(error.code??error.message);process.exitCode=9}
finally{console.log(JSON.stringify({activeMode:mode,stopCalls,restarted}))}
`)
    let supervisor, independentProcess, preparationLock, replacement
    const invoke = async mode => {
      const child = spawn(process.execPath, [childFile, stateFile, mode], { windowsHide: true, shell: false })
      let output = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk })
      const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
      const proof = JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('{"activeMode"')) ?? 'null')
      console.log(redact(output, secrets)); checkpoints.push({ mode, exit, proof })
      if (mode === 'fail-down' || mode === 'restart-down') assert.equal(proof.stopCalls, 1)
      if (mode === 'restart-down') { assert.equal(proof.restarted.length, 1); assert.match(output, /FOUNDATION_STOP_INCOMPLETE/) }
      return exit
    }
    const start = async () => {
      // Each run follows a real preparation owner, including retries after down.
      const preparedFoundation = factory(); preparedFoundation.preflight(true, readJson(join(directory, 'prepared.json')).volumes)
      preparationLock = acquireLock({ mode: 'local', fingerprint: state.fingerprint, directory: locks })
      await preparedFoundation.start(['postgres', 'redis'], { onChange: resources => preparationJournal(state, preparationLock, resources) })
      preparationLock.release(); preparationLock = undefined
      rmSync(pidFile, { force: true })
      supervisor = await spawnOwned({ name: 'active-supervisor', command: process.execPath, args: [childFile, stateFile, 'supervise'], cwd: root, environment: process.env },
        { onLog: (_name, line) => logs.push(line) })
      const deadline = Date.now() + 60000
      while (Date.now() < deadline) {
        if (supervisor.child.exitCode !== null) throw new Error(`Supervisor failed: ${logs.join('\n')}`)
        const record = existsSync(join(locks, 'mode-lock.json')) ? readJson(join(locks, 'mode-lock.json')) : undefined
        if (record?.state === 'ready' && existsSync(pidFile)) {
          assert.notEqual(record.identity.pid, process.pid); assert.equal(identityAlive(record.identity), true)
          assert.equal(record.children.length, 1); assert.equal(identityAlive(record.children[0].identity), true)
          return { record, application: processIdentity(readJson(pidFile)) }
        }
        await delay(100)
      }
      throw new Error('Active fixture readiness timeout')
    }
    const assertExited = async run => {
      assert.equal((await supervisor.exited).code, 0); await stopOwned([supervisor]); supervisor = undefined
      assert.equal(identityAlive(run.record.identity), false); assert.equal(identityAlive(run.application), false)
      for (const child of run.record.children) assert.equal(identityAlive(child.identity), false)
      assert.equal(identityAlive(independentProcess.identity), true)
    }
    try {
      independentProcess = await spawnOwned({ name: 'independent', command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd: root, environment: process.env })
      if (independentRedis) { base.preflight(false); await base.start(['redis']) }
      const preparation = factory(); preparation.preflight(false)
      preparationLock = acquireLock({ mode: 'local', fingerprint: state.fingerprint, directory: locks })
      await preparation.start(['postgres', 'redis'], { onChange: resources => preparationJournal(state, preparationLock, resources) })
      preparation.compose(['exec', '-T', 'postgres', 'sh', '/docker-entrypoint-initdb.d/10-local-databases.sh'])
      preparation.compose(['run', '--rm', '--no-deps', 'hydra', 'migrate', 'sql', 'up', '--read-from-env', '--yes'])
      const volumes = preparation.verifyVolumes()
      savePrepared(state, { volumes, stages: { initialized: true } }); preparationLock.release(); preparationLock = undefined
      const prepared = readFileSync(join(directory, 'prepared.json')), preparationRecord = readJson(join(directory, 'foundation.json'))
      assert.deepEqual(preparationRecord.resources.started.map(item => item.service).sort(), independentRedis ? ['postgres'] : ['postgres', 'redis'])
      base.compose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-c', "CREATE TABLE active_down_marker(value text); INSERT INTO active_down_marker VALUES ('preserved')"])
      base.compose(['exec', '-T', 'redis', 'redis-cli', 'set', 'active-down-marker', 'preserved']); base.compose(['exec', '-T', 'redis', 'redis-cli', 'save'])
      let run = await start()
      assert.deepEqual(run.record.resources.preRunning.map(item => item.service).sort(), ['postgres', 'redis'])
      assert.deepEqual(run.record.resources.started.map(item => item.service), ['hydra'])
      const originalProofs = run.record.resources.containerProofs
      assert.equal(await invoke('down'), 0); await assertExited(run)
      assert.equal(await invoke('down'), 0)
      const running = base.containers().filter(item => item.State.Running).map(item => item.Config.Labels['com.docker.compose.service']).sort()
      assert.deepEqual(running, independentRedis ? ['redis'] : [])
      assert.equal(readJson(join(directory, 'run.json')).state, 'stopped'); assert.equal(existsSync(join(locks, 'mode-lock.json')), false)
      if (independentRedis) {
        for (const handoff of ['live-owner', 'released-preparation']) {
          run = await start(); const calls = []; let newPreparation
          await assert.rejects(downLocal({ state, foundation: factory({ runner: (cmd, args, opts) => { calls.push(args); return spawnSync(cmd, args, opts) } }), directory: locks,
            externalCheck: () => {}, control: async (...args) => {
              const completed = await controlRequest(...args)
              replacement = acquireLock({ mode: 'local', fingerprint: state.fingerprint, directory: locks })
              if (handoff === 'released-preparation') {
                const preparedFoundation = factory(); preparedFoundation.preflight(true, volumes)
                newPreparation = preparationJournal(state, replacement, preparedFoundation.snapshot())
                replacement.release(); replacement = undefined
              }
              return completed
            } }), /MODE_ACTIVE|MODE_OWNERSHIP_CHANGED/)
          await assertExited(run)
          assert.equal(calls.some(args => args[0] === 'stop'), false)
          if (replacement) { assert.deepEqual(readJson(replacement.path), replacement.record); replacement.release(); replacement = undefined }
          else { assert.equal(existsSync(join(locks, 'mode-lock.json')), false); assert.deepEqual(readJson(join(directory, 'foundation.json')), newPreparation) }
          checkpoints.push({ handoff, zeroFoundationStops: true, replacementUnmodified: true })
          assert.equal(await invoke('down'), 0)
        }
        // Failure follows actual control completion; the failing CLI exits, then a fresh CLI recovers.
        for (const fault of ['fail-down', 'restart-down']) {
          run = await start()
          const remaining = run.record.resources.preRunning.filter(item => preparationRecord.resources.started.some(owned => owned.id === item.id))
          assert.deepEqual(remaining.map(item => item.service), ['postgres'])
          assert.equal(base.inspect(remaining[0].id).State.Running, true)
          assert.equal(await invoke(fault), 9); await assertExited(run)
          assert.equal(base.inspect(remaining[0].id).State.Running, true)
          assert.equal(base.inspect(run.record.resources.started[0].id).State.Running, false)
          checkpoints.push({ fault, postControlOwnedPgStillRunning: remaining[0].id, supervisorHydraStopped: true })
          const retained = readJson(join(locks, 'mode-lock.json'))
          assert.equal(retained.cleanupRequired, true); assert.equal(retained.recovery.runId, run.record.runId)
          assert.deepEqual(retained.recovery.identity, run.record.identity)
          for (const proof of originalProofs) base.verifyRecordedContainer(base.inspect(proof.id), proof)
          for (const mode of ['local', 'dev', 'full']) assert.throws(() => acquireLock({ mode, fingerprint: state.fingerprint, directory: locks }), /CLEANUP_REQUIRED/)
          assert.equal(await invoke('down'), 0); assert.equal(await invoke('down'), 0)
        }
      }
      assert.deepEqual(base.verifyVolumes(), volumes); assert.deepEqual(readFileSync(join(directory, 'prepared.json')), prepared)
      for (const proof of originalProofs) base.verifyRecordedContainer(base.inspect(proof.id), proof)
      await base.start(['postgres', 'redis'])
      assert.equal(base.compose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-At', '-c', 'SELECT value FROM active_down_marker']).stdout.trim(), 'preserved')
      assert.equal(base.compose(['exec', '-T', 'redis', 'redis-cli', 'get', 'active-down-marker']).stdout.trim(), 'preserved')
      console.log(JSON.stringify({ project, independentRedis, actualProductionControlAndSupervisor: true, originalOwnerAndPrivateChildrenExited: true,
        independentProcessPreserved: true, originalProofs, volumes, bothMarkersPreserved: true, checkpoints, logs }))
    } finally {
      if (supervisor) await stopOwned([supervisor]); if (independentProcess) await stopOwned([independentProcess])
      preparationLock?.release(); replacement?.release()
      base.compose(['down', '--volumes', '--remove-orphans'], true)
      const afterContainers = base.call(['ps', '-a', '--format', '{{.ID}} {{.Names}} {{.State}}']).stdout.trim().split(/\r?\n/).filter(Boolean)
      assert.deepEqual(afterContainers.sort(), beforeContainers.sort())
      console.log(JSON.stringify({ project, originalContainerStatesPreserved: true, noFixtureExtras: true }))
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

test('production initializeLocal partial failures recover in new processes without prepared or losing volumes/data', { timeout: 400000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'local-partial-real-')), project = `exwebsite-local-test-${randomUUID().slice(0, 8)}`
  const ports = { ...defaults }
  for (const name of Object.keys(ports)) ports[name] = await freePort()
  const secrets = Object.fromEntries(secretNames.map(key => [key, randomBytes(32).toString('hex')]))
  const config = { ports, publicOrigin: `http://127.0.0.1:${ports.public}`, issuer: `http://127.0.0.1:${ports.hydraPublic}/`,
    clientId: 'ex-outline-local', callback: `http://127.0.0.1:${ports.public}/docs/auth/oidc.callback`, storage: join(directory, 'outline') }
  const state = { config, secrets, directory, workspace: root, website: {}, fingerprint: digest({ config, secrets }) }
  const foundation = new Foundation(state, { project }), locks = join(directory, 'locks')
  const beforeContainers = foundation.call(['ps', '-a', '--format', '{{.ID}} {{.Names}}']).stdout.trim().split(/\r?\n/).filter(Boolean)
  const moduleUrl = name => pathToFileURL(join(root, 'scripts/docs-integration', name)).href
  const stateFile = join(directory, 'state.json'), childFile = join(directory, 'initialize.mjs')
  atomicJson(stateFile, state)
  writeFileSync(childFile, `import{readJson,LocalError}from ${JSON.stringify(moduleUrl('local-config.mjs'))};
import{Foundation}from ${JSON.stringify(moduleUrl('foundation.mjs'))};
import{initializeLocal,downLocal}from ${JSON.stringify(moduleUrl('local-dev.mjs'))};
import{runOwned}from ${JSON.stringify(moduleUrl('ownership.mjs'))};
import{acquireLock}from ${JSON.stringify(moduleUrl('ownership.mjs'))};
import{spawnSync}from'node:child_process';import{join}from'node:path';
const state=readJson(process.argv[2]),fault=process.argv[3],foundation=new Foundation(state,{project:${JSON.stringify(project)},runner:(command,args,options)=>{
if(fault==='sql'&&args.some(arg=>arg.endsWith('/10-local-databases.sh')))return{status:1,stdout:'',stderr:'fixture SQL fault'};
return spawnSync(command,args,options)}});
if(fault==='zero'){acquireLock({mode:'local',fingerprint:state.fingerprint,directory:join(state.directory,'locks')});process.exit(7)}
try{if(fault==='down')await downLocal({state,foundation,directory:join(state.directory,'locks'),control:async()=>false,externalCheck:()=>{}});
else await initializeLocal(state,{foundation,directory:join(state.directory,'locks'),externalCheck:()=>{},execute:async(spec,options)=>{
if(fault==='migration'&&spec.args.includes('db:migrate'))throw new LocalError('DISPOSABLE_MIGRATION_FAULT');
if(spec.args.includes('build:server')){if(fault==='build')throw new LocalError('DISPOSABLE_BUILD_FAULT');console.log('DISPOSABLE_BUILD_ONLY_REPLACEMENT');return;}
await runOwned(spec,options)}});process.exitCode=0}catch(error){console.log(error.code??error.message);process.exitCode=9}
`)
  const exits = []
  let blocker, unknown, unknownVolume
  const invoke = fault => {
    const result = spawnSync(process.execPath, [childFile, stateFile, fault], { encoding: 'utf8', windowsHide: true, timeout: 150000 })
    console.log(redact(result.stdout + result.stderr, secrets)); exits.push({ fault, exit: result.status }); return result
  }
  try {
    assert.equal(invoke('zero').status, 7)
    const images = JSON.parse(readFileSync(join(root, 'infra/docs-integration/images.lock.json'), 'utf8'))
    unknownVolume = `${project}_unknown`
    foundation.call(['volume', 'create', '--label', `com.docker.compose.project=${project}`, unknownVolume])
    assert.equal(invoke('sql').status, 9)
    foundation.call(['volume', 'rm', unknownVolume]); unknownVolume = undefined
    unknown = foundation.call(['create', '--label', `com.docker.compose.project=${project}`, images.node, 'node', '--version']).stdout.trim()
    assert.equal(invoke('sql').status, 9)
    assert.equal(readJson(join(locks, 'mode-lock.json')).cleanupRequired, true)
    foundation.call(['rm', unknown]); unknown = undefined
    blocker = foundation.call(['run', '-d', '--label', `dev.exwebsite.fixture=${project}`, '-p', `127.0.0.1:${ports.postgres}:5432`, images.node,
      'node', '-e', 'process.on("SIGTERM",()=>process.exit(0));setInterval(()=>{},1000)']).stdout.trim()
    assert.equal(invoke('sql').status, 9)
    const failedCreate = readJson(join(directory, 'foundation.json'))
    assert.deepEqual(failedCreate.resources.started, [])
    assert.equal(failedCreate.resources.createdStopped.length, 1)
    assert.equal(failedCreate.preparation.volumes.length, 1)
    const neverStartedId = failedCreate.resources.createdStopped[0].id
    foundation.call(['rm', '-f', blocker]); blocker = undefined
    assert.equal(invoke('sql').status, 9)
    assert.equal(existsSync(join(directory, 'prepared.json')), false)
    assert.throws(() => preparedState(state, true), /LOCAL_NOT_INITIALIZED/)
    const partial = readJson(join(directory, 'foundation.json'))
    assert.equal(partial.preparation.status, 'partial'); assert.equal(partial.preparation.stage, 'databases')
    assert.ok(partial.resources.started.length >= 2)
    const volumes = foundation.verifyVolumes(), ids = foundation.containers().map(item => item.Id).sort()
    assert.equal(foundation.inspect(neverStartedId), null)
    foundation.compose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-c', "CREATE TABLE wave2_marker(value text); INSERT INTO wave2_marker VALUES ('preserved')"])
    for (const fault of ['migration', 'build']) {
      assert.equal(invoke(fault).status, 9)
      assert.equal(existsSync(join(directory, 'prepared.json')), false)
      assert.deepEqual(foundation.verifyVolumes(), volumes)
      assert.deepEqual(foundation.containers().map(item => item.Id).sort(), ids)
    }
    assert.equal(invoke('success').status, 0)
    assert.equal(readJson(join(directory, 'prepared.json')).stages.initialized, true)
    assert.deepEqual(foundation.verifyVolumes(), volumes)
    assert.equal(foundation.compose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-At', '-c', 'SELECT value FROM wave2_marker']).stdout.trim(), 'preserved')
    assert.equal(invoke('down').status, 0); assert.equal(invoke('down').status, 0)
    assert.equal(foundation.containers().some(item => item.State.Running), false)
    console.log(JSON.stringify({ project, exits, productionInitializeLocal: true, partialSqlMigrationBuildRecovered: true,
      onlyBuildReplaced: true, originalIds: ids, volumes, markerPreserved: true, newProcessDownIdempotent: true,
      genuineZeroPreflightExit7: true, zeroUnknownRejected: true, partialSingleVolumeAndNeverStartedRecovered: true, retiredNeverStartedId: neverStartedId }))
  } finally {
    if (unknown) foundation.call(['rm', unknown], true)
    if (blocker) foundation.call(['rm', '-f', blocker], true)
    if (unknownVolume) foundation.call(['volume', 'rm', unknownVolume], true)
    foundation.compose(['down', '--volumes', '--remove-orphans'], true)
    const afterContainers = foundation.call(['ps', '-a', '--format', '{{.ID}} {{.Names}}']).stdout.trim().split(/\r?\n/).filter(Boolean)
    assert.equal(beforeContainers.every(item => afterContainers.includes(item)), true)
    assert.equal(afterContainers.some(item => item.includes(project)), false)
    console.log(JSON.stringify({ project, beforeContainers, afterContainers, cleaned: true }))
    rmSync(directory, { recursive: true, force: true })
  }
})

async function freePort() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
test('actual isolated Docker local init is idempotent and adoption/cleanup preserves independent services', { timeout: 300000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'local-docker-')), project = `exwebsite-local-test-${randomUUID().slice(0, 8)}`
  assert.match(project, /^exwebsite-local-test-/)
  const ports = { ...defaults }, used = new Set()
  for (const name of Object.keys(ports)) { do { ports[name] = await freePort() } while (used.has(ports[name])); used.add(ports[name]) }
  const secrets = Object.fromEntries(secretNames.map(key => [key, randomBytes(32).toString('hex')]))
  const config = { ports, publicOrigin: `http://127.0.0.1:${ports.public}`, issuer: `http://127.0.0.1:${ports.hydraPublic}/`,
    clientId: 'ex-outline-local', callback: `http://127.0.0.1:${ports.public}/docs/auth/oidc.callback`, storage: join(directory, 'outline') }
  const state = { config, secrets, directory, workspace: root, website: {}, fingerprint: digest({ config, secrets }) }
  const foundation = new Foundation(state, { project }), logs = []
  const beforeContainers = foundation.call(['ps', '-a', '--format', '{{.ID}} {{.Names}}']).stdout.trim().split(/\r?\n/).filter(Boolean)
  try {
    assert.throws(() => foundation.preflight(), /VOLUME_MISSING/)
    foundation.preflight(false)
    await foundation.start(['postgres', 'redis'])
    foundation.compose(['exec', '-T', 'postgres', 'sh', '/docker-entrypoint-initdb.d/10-local-databases.sh'])
    const query = "SELECT datname,pg_get_userbyid(datdba) owner FROM pg_database WHERE datname NOT IN ('postgres','template0','template1') ORDER BY datname"
    const before = foundation.compose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-At', '-c', query]).stdout
    assert.equal(before.trim(), 'hydra|hydra\noutline|outline')
    const credentials = foundation.compose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-At', '-c', "SELECT rolname,rolpassword FROM pg_authid WHERE rolname IN ('outline','hydra') ORDER BY rolname"]).stdout
    foundation.compose(['exec', '-T', 'postgres', 'sh', '/docker-entrypoint-initdb.d/10-local-databases.sh'])
    assert.equal(foundation.compose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-At', '-c', query]).stdout, before)
    assert.equal(foundation.compose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-At', '-c', "SELECT rolname,rolpassword FROM pg_authid WHERE rolname IN ('outline','hydra') ORDER BY rolname"]).stdout, credentials)
    foundation.compose(['run', '--rm', '--no-deps', 'hydra', 'migrate', 'sql', 'up', '--read-from-env', '--yes'])
    const tools = toolchain()
    await runOwned(cliSpecification(state, tools, 'outline', ['db:migrate', '--env', 'production-ssl-disabled']), { onLog: (_, line) => logs.push(line) })
    await verifyFoundationSchemas(state)
    const volumes = foundation.verifyVolumes()
    const second = new Foundation(state, { project })
    second.preflight(true, volumes)
    assert.equal(second.preRunning.size, 2)
    await second.start(['postgres', 'redis', 'hydra'])
    await foundationReady(state, second)
    assert.equal(second.started.size, 1)
    await second.stopStarted()
    const running = foundation.containers().filter(container => container.State.Running).map(container => container.Config.Labels['com.docker.compose.service']).sort()
    assert.deepEqual(running, ['postgres', 'redis'])
    const badState = { ...state, secrets: { ...secrets, OUTLINE_PASSWORD: randomBytes(32).toString('hex') }, fingerprint: 'different' }
    assert.throws(() => new Foundation(badState, { project }).preflight(), /OWNERSHIP_CONFLICT/)
    // A started-container journal must remain observable even when a later Compose step fails.
    console.log(JSON.stringify({ project, databases: ['hydra', 'outline'], repeatedInitStable: true,
      beforeContainers, preRunningIds: [...second.preRunning.keys()], startedIds: [...second.started.keys()],
      preRunningPreserved: running, startedStopped: ['hydra'], volumes: volumes.map(value => ({ name: value.name, createdAt: value.createdAt })) }))
  } finally {
    for (const container of foundation.containers()) {
      if (container.State.Running || container.Config.Labels['com.docker.compose.service'] !== 'postgres') continue
      const output = foundation.call(['logs', container.Id], true)
      console.log(redact(output.stdout + output.stderr, secrets))
    }
    // Test-only disposable project, verified above; production cleanup never deletes volumes.
    foundation.compose(['down', '--volumes', '--remove-orphans'], true)
    const afterContainers = foundation.call(['ps', '-a', '--format', '{{.ID}} {{.Names}}']).stdout.trim().split(/\r?\n/).filter(Boolean)
    assert.equal(afterContainers.some(value => value.includes(project)), false)
    assert.equal(beforeContainers.every(value => afterContainers.includes(value)), true)
    console.log(JSON.stringify({ project, afterContainers, independentContainersPreserved: true }))
    rmSync(directory, { recursive: true, force: true })
  }
})

test('actual production orphan down restores supervisor journals, rejects Docker tamper and retains cleanup intent through failures', { timeout: 600000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'local-down-docker-')), locks = join(directory, 'locks')
  const project = `exwebsite-local-test-${randomUUID().slice(0, 8)}`, ports = { ...defaults }, used = new Set()
  for (const name of Object.keys(ports)) { do { ports[name] = await freePort() } while (used.has(ports[name])); used.add(ports[name]) }
  const secrets = Object.fromEntries(secretNames.map(key => [key, randomBytes(32).toString('hex')]))
  const config = { ports, publicOrigin: `http://127.0.0.1:${ports.public}`, issuer: `http://127.0.0.1:${ports.hydraPublic}/`,
    clientId: 'ex-outline-local', callback: `http://127.0.0.1:${ports.public}/docs/auth/oidc.callback`, storage: join(directory, 'outline') }
  const state = { config, secrets, directory, workspace: root, website: {}, fingerprint: digest({ config, secrets }) }
  const base = new Foundation(state, { project }), beforeContainers = base.call(['ps', '-a', '--format', '{{.ID}} {{.Names}}']).stdout.trim().split(/\r?\n/).filter(Boolean)
  const factory = options => new Foundation(state, { project, ...options }), log = [], checkpoints = [], childExitCodes = []
  let owned, preparationLock
  const moduleUrl = name => pathToFileURL(join(root, 'scripts/docs-integration', name)).href
  const options = foundation => ({ state, foundation, directory: locks, control: async () => false, externalCheck: () => {} })
  try {
    // Independent Redis is already running before the managed preparation starts.
    base.preflight(false); await base.start(['redis'])
    const redisId = [...base.started.keys()][0], preparation = factory()
    preparation.preflight(false)
    preparationLock = acquireLock({ mode: 'local', fingerprint: state.fingerprint, directory: locks })
    await preparation.start(['postgres', 'redis'], { onChange: resources => preparationJournal(state, preparationLock, resources) })
    preparation.compose(['exec', '-T', 'postgres', 'sh', '/docker-entrypoint-initdb.d/10-local-databases.sh'])
    preparation.compose(['run', '--rm', '--no-deps', 'hydra', 'migrate', 'sql', 'up', '--read-from-env', '--yes'])
    savePrepared(state, { volumes: preparation.verifyVolumes(), stages: { initialized: true } })
    preparationJournal(state, preparationLock, preparation.snapshot()); preparationLock.release(); preparationLock = undefined
    // Repeat the production preparation journal with no new starts: prior PG remains owned, Redis remains independent.
    const repeated = factory(); repeated.preflight(true, readJson(join(directory, 'prepared.json')).volumes)
    preparationLock = acquireLock({ mode: 'local', fingerprint: state.fingerprint, directory: locks })
    preparationJournal(state, preparationLock, repeated.snapshot()); preparationLock.release(); preparationLock = undefined
    assert.deepEqual(readJson(join(directory, 'foundation.json')).resources.started.map(item => item.service), ['postgres'])
    const query = "SELECT datname,pg_get_userbyid(datdba) FROM pg_database WHERE datname IN ('outline','hydra') ORDER BY datname"
    const databaseBefore = base.compose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-At', '-c', query]).stdout
    const preparedBefore = readFileSync(join(directory, 'prepared.json')), volumesBefore = base.verifyVolumes()
    const childFile = join(directory, 'supervisor.mjs'), stateFile = join(directory, 'fixture-state.json')
    atomicJson(stateFile, state)
    writeFileSync(childFile, `import { readJson,atomicJson } from ${JSON.stringify(moduleUrl('local-config.mjs'))};
import { Foundation } from ${JSON.stringify(moduleUrl('foundation.mjs'))};
import { acquireLock } from ${JSON.stringify(moduleUrl('ownership.mjs'))};
import { supervise,foundationReady } from ${JSON.stringify(moduleUrl('local-dev.mjs'))};
import { join } from 'node:path';
const state=readJson(process.argv[2]),foundation=new Foundation(state,{project:${JSON.stringify(project)}});
const lock=acquireLock({mode:'local',fingerprint:state.fingerprint,directory:join(state.directory,'locks')});
foundation.preflight(true,readJson(join(state.directory,'prepared.json')).volumes);
await foundation.start(['postgres','redis','hydra'],{onChange:resources=>{lock.update({resources});atomicJson(join(state.directory,'run.json'),{...lock.record,resources})}});
await supervise({mode:'local',fingerprint:state.fingerprint,directory:state.directory,controlDirectory:join(state.directory,'locks'),lock,foundation,
specifications:[],readiness:async()=>{await foundationReady(state,foundation);setTimeout(()=>process.exit(7),100)},banner:'DISPOSABLE_SUPERVISOR_READY'});
`, { mode: 0o600 })
    const downChildFile = join(directory, 'failed-down.mjs')
    writeFileSync(downChildFile, `import {readJson,atomicJson} from ${JSON.stringify(moduleUrl('local-config.mjs'))};
import {Foundation} from ${JSON.stringify(moduleUrl('foundation.mjs'))};
import {downLocal} from ${JSON.stringify(moduleUrl('local-dev.mjs'))};
import {join} from 'node:path';const state=readJson(process.argv[2]);let writes=0;
try{await downLocal({state,foundation:new Foundation(state,{project:${JSON.stringify(project)}}),directory:join(state.directory,'locks'),control:async()=>false,externalCheck:()=>{},
persist:(path,value)=>{if(++writes===3)throw new Error('disposable final write failure');atomicJson(path,value)}});process.exit(2)}
catch{console.log('DISPOSABLE_DOWN_FAILED_WITH_RETAINED_INTENT');process.exit(9)};
`, { mode: 0o600 })
    const crash = async () => {
      owned = await spawnOwned({ name: 'disposable-supervisor', command: process.execPath, args: [childFile, stateFile], cwd: root, environment: process.env },
        { onLog: (_name, line) => log.push(line) })
      assert.equal((await owned.exited).code, 7); childExitCodes.push(7); await stopOwned([owned]); owned = undefined
      const runtime = readJson(join(directory, 'run.json')); assert.equal(runtime.state, 'ready')
      assert.equal(runtime.resources.started.some(item => item.service === 'hydra'), true)
      assert.equal(processIdentity(runtime.identity.pid), null)
      return runtime
    }
    const firstRun = await crash(), ownedIds = [firstRun.resources.started[0].id, readJson(join(directory, 'foundation.json')).resources.started[0].id]
    const pgId = ownedIds[1], actualPg = base.inspect(pgId), restart = actualPg.HostConfig.RestartPolicy.Name
    base.call(['update', '--restart', 'always', pgId])
    const calls = [], traced = factory({ runner: (command, argv, opts) => { calls.push(argv); return spawnSync(command, argv, opts) } })
    await assert.rejects(downLocal(options(traced)), /OWNERSHIP_CONFLICT/)
    assert.equal(calls.some(argv => argv[0] === 'stop'), false)
    assert.equal(readJson(join(locks, 'mode-lock.json')).cleanupRequired, true)
    for (const mode of ['local', 'dev', 'full']) assert.throws(() => acquireLock({ mode, fingerprint: state.fingerprint, directory: locks }), /CLEANUP_REQUIRED/)
    base.call(['update', '--restart', restart || 'no', pgId])
    await downLocal(options(factory())); await downLocal(options(factory()))
    assert.equal(base.inspect(redisId).State.Running, true); assert.equal(ownedIds.every(id => !base.inspect(id).State.Running), true)
    checkpoints.push({ phase: 'actual-restart-policy-negative-and-exact-recovery', zeroStopsOnTamper: true, runtimeRunId: firstRun.runId, ownedIds, independentRedis: redisId })
    // A failed inspect must not hide an existing exact ID, even if project labels
    // were changed. The fallback is the real global no-trunc inventory.
    for (const fault of ['inspect', 'inventory', 'invalid-inventory']) {
      await crash(); const inspectionCalls = [], failing = factory({ runner: (command, argv, opts) => {
        inspectionCalls.push(argv)
        if (argv[0] === 'inspect' && argv[1] === pgId) return { status: 1, stdout: '[]', stderr: '' }
        if (argv[0] === 'ps' && argv.includes('--no-trunc')) {
          if (fault === 'inventory') return { status: 1, stdout: '', stderr: '' }
          if (fault === 'invalid-inventory') return { status: 0, stdout: 'invalid inventory', stderr: '' }
        }
        return spawnSync(command, argv, opts)
      } })
      const expected = fault === 'inspect' ? 'DOCKER_INSPECTION_FAILED' : fault === 'inventory' ? 'LOCAL_DOCKER_FAILED' : 'DOCKER_INVENTORY_INVALID'
      await assert.rejects(downLocal(options(failing)), error => error.code === expected)
      assert.equal(inspectionCalls.some(argv => argv[0] === 'stop'), false)
      assert.equal(inspectionCalls.some(argv => JSON.stringify(argv) === JSON.stringify(['ps', '-a', '--no-trunc', '--format', '{{.ID}} {{.Names}}'])), true)
      assert.equal(ownedIds.every(id => base.inspect(id).State.Running), true)
      const retained = readJson(join(locks, 'mode-lock.json'))
      assert.equal(retained.cleanupRequired, true); assert.ok(retained.resources.containerProofs.length)
      for (const mode of ['local', 'dev', 'full']) assert.throws(() => acquireLock({ mode, fingerprint: state.fingerprint, directory: locks }), /CLEANUP_REQUIRED/)
      await downLocal(options(factory()))
      assert.equal(existsSync(join(locks, 'mode-lock.json')), false); assert.equal(base.inspect(redisId).State.Running, true)
      checkpoints.push({ phase: fault, actualFailureCode: expected, zeroStops: true, completeIntentRetained: true, exactRetry: true })
    }
    // A stale record is produced by a real exited process for each failure, never by selecting a user PID.
    for (const fault of ['stop1', 'stop2', 'write1', 'write2', 'write3']) {
      await crash(); let stops = 0, writes = 0
      const failing = factory({ runner: (command, argv, opts) => {
        if (argv[0] === 'stop' && ++stops === Number(fault.replace('stop', ''))) return { status: 1, stdout: '', stderr: '' }
        return spawnSync(command, argv, opts)
      } })
      const persist = (path, value) => { if (++writes === Number(fault.replace('write', ''))) throw new Error('disposable journal-write failure'); atomicJson(path, value) }
      let retryLock
      if (fault === 'write3') {
        owned = await spawnOwned({ name: 'disposable-failed-down', command: process.execPath, args: [downChildFile, stateFile], cwd: root, environment: process.env },
          { onLog: (_name, line) => log.push(line) })
        assert.equal((await owned.exited).code, 9); childExitCodes.push(9); await stopOwned([owned]); owned = undefined
        assert.equal(processIdentity(readJson(join(locks, 'mode-lock.json')).identity.pid), null)
      } else await assert.rejects(downLocal({ ...options(failing), persist, onLock: value => { retryLock = value } }), error => {
        console.log(JSON.stringify({ fault, actualFailureCode: error.code ?? error.name, stops, writes }))
        return fault.startsWith('stop') ? error.code === 'LOCAL_DOCKER_FAILED' : error.message === 'disposable journal-write failure'
      })
      if (fault.startsWith('stop')) assert.equal(stops, Number(fault.at(-1)))
      if (fault === 'write1' || fault === 'write2') assert.equal(stops, 0)
      const retained = readJson(join(locks, 'mode-lock.json'))
      assert.equal(retained.cleanupRequired, true); assert.ok(retained.resources.containerProofs.length)
      for (const mode of ['local', 'dev', 'full']) assert.throws(() => acquireLock({ mode, fingerprint: state.fingerprint, directory: locks }), /CLEANUP_REQUIRED/)
      // Same current owner retries using the original genuine lock capability when acquisition already succeeded;
      // pre-acquisition failures retain the exited original owner and recover through the atomic gate instead.
      await downLocal({ ...options(factory()), ...(retryLock ? { lock: retryLock } : {}) })
      assert.equal(existsSync(join(locks, 'mode-lock.json')), false)
      assert.equal(base.inspect(redisId).State.Running, true)
      checkpoints.push({ phase: fault, stoppedBeforeFailure: fault === 'write3' ? 2 : stops, writesBeforeFailure: fault === 'write3' ? 3 : writes,
        failedDownChildExited: fault === 'write3' ? 9 : undefined, protected: true, exactRetry: true })
    }
    // Explicitly remove only our proven stopped Hydra fixture, without force or
    // volumes. The same production down can then prove its exact ID is absent.
    const hydraId = ownedIds[0], stoppedHydra = base.inspect(hydraId)
    assert.equal(stoppedHydra.State.Running, false)
    const stoppedReceipt = readJson(join(directory, 'run.json'))
    base.verifyRecordedContainer(stoppedHydra, stoppedReceipt.resources.containerProofs.find(proof => proof.id === hydraId))
    base.call(['rm', hydraId]); assert.equal(base.inspect(hydraId), null)
    const missingCalls = [], missingFoundation = factory({ runner: (command, argv, opts) => { missingCalls.push(argv); return spawnSync(command, argv, opts) } })
    await downLocal(options(missingFoundation))
    assert.equal(missingCalls.some(argv => argv[0] === 'stop'), false)
    assert.equal(missingCalls.some(argv => argv[0] === 'ps' && argv.includes('--no-trunc')), true)
    checkpoints.push({ phase: 'actual-deleted-owned-id', id: hydraId, zeroStops: true, idempotentDown: true, volumesRetained: true })
    assert.deepEqual(readFileSync(join(directory, 'prepared.json')), preparedBefore)
    assert.equal(digest(base.verifyVolumes()), digest(volumesBefore))
    await base.start(['postgres'])
    assert.equal(base.compose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-At', '-c', query]).stdout, databaseBefore)
    console.log(JSON.stringify({ project, beforeContainers, checkpoints, originalPreparedAndVolumesPreserved: true, databasesPreserved: true,
      childExitCodes, logs: log }))
  } finally {
    if (owned) await stopOwned([owned]); preparationLock?.release()
    base.compose(['down', '--volumes', '--remove-orphans'], true)
    const afterContainers = base.call(['ps', '-a', '--format', '{{.ID}} {{.Names}}']).stdout.trim().split(/\r?\n/).filter(Boolean)
    assert.equal(afterContainers.some(value => value.includes(project)), false)
    assert.equal(beforeContainers.every(value => afterContainers.includes(value)), true)
    console.log(JSON.stringify({ project, afterContainers, allOriginalContainersPreserved: true, fixtureCleanupComplete: true }))
    rmSync(directory, { recursive: true, force: true })
  }
})
