import assert from 'node:assert/strict'
import test from 'node:test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { request as httpRequest } from 'node:http'
import { root } from './configure.mjs'
import { Foundation } from './foundation.mjs'
import { awaitingGatewayTemplate, legacyInitRecipe, legacyRuntimeServices, pauseContainers, prepareHydraWithoutGateway, transitionStoppedApplications, fullUpRuntime, fullDownRuntime } from './legacy.mjs'
import { redact, acquireLock, processIdentity } from './ownership.mjs'
import { digest, secretNames } from './local-config.mjs'
import { httpReady } from './local-dev.mjs'

test('fresh legacy CLI retains early preparation and paused application failures with original temporary and volume proofs', { timeout: 550000 }, async () => {
  const workspace = mkdtempSync(join(root, '.local/docs-integration/legacy-pause-real-')), project = `exwebsite-legacy-test-${randomUUID().slice(0, 8)}`
  const directory = join(workspace, 'control'), composePath = join(workspace, 'compose.json'), gatewayTemplate = join(workspace, 'gateway')
  mkdirSync(directory); writeFileSync(gatewayTemplate, 'isolated pause and early cleanup gateway')
  const images = JSON.parse(readFileSync(join(root, 'infra/docs-integration/images.lock.json'), 'utf8'))
  const services = Object.fromEntries(['postgres', 'redis', 'hydra', 'server', 'web', 'outline', 'gateway'].map(service => [service, {
    image: images.node, entrypoint: ['node'], command: ['-e', 'process.on("SIGTERM",()=>process.exit(0));setInterval(()=>{},1000)'],
    volumes: [`${service === 'postgres' ? 'pgdata' : 'data'}:/data`] }]))
  delete services.server.image
  services.server.build = { context: workspace, dockerfile: 'Dockerfile.fixture' }
  writeFileSync(join(workspace, 'Dockerfile.fixture'), `FROM ${images.node}\nLABEL dev.exwebsite.fixture=${project}\n`)
  writeFileSync(composePath, JSON.stringify({ services, volumes: { data: {}, pgdata: {} } }))
  const state = { workspace, fingerprint: 'fixture-pause' }, foundation = new Foundation(state, { project, file: composePath, environment: process.env })
  foundation.waitPostgres = async () => {}
  const before = foundation.call(['ps', '-a', '--format', '{{.ID}} {{.Names}}']).stdout.trim().split(/\r?\n/)
  const beforeImages = foundation.call(['image', 'ls', '--no-trunc', '--format', '{{.ID}} {{.Repository}}:{{.Tag}}']).stdout.trim().split(/\r?\n/)
  assert.ok(foundation.configuration().services.server.build); assert.equal(foundation.configuration().services.server.image, undefined)
  const childPath = join(workspace, 'cli.mjs'), moduleUrl = name => pathToFileURL(join(root, 'scripts/docs-integration', name)).href
  writeFileSync(childPath, `import{legacyCommand,prepareFullRuntime}from ${JSON.stringify(moduleUrl('legacy.mjs'))};
import{Foundation}from ${JSON.stringify(moduleUrl('foundation.mjs'))};import{acquireLock}from ${JSON.stringify(moduleUrl('ownership.mjs'))};
import{LocalError,atomicJson,readJson,digest}from ${JSON.stringify(moduleUrl('local-config.mjs'))};import{spawnSync}from'node:child_process';import{join}from'node:path';import{randomUUID}from'node:crypto';
const[operation,mode]=process.argv.slice(2),directory=${JSON.stringify(directory)},workspace=${JSON.stringify(workspace)},gatewayTemplate=${JSON.stringify(gatewayTemplate)};
let stops=0,restarts=0,prepared=0,armed=operation==='pause-initial',temporaryActive=false,gatewayId,currentState,createdTemporaryId;
const make=()=>{const state={workspace,mode,fingerprint:'fixture-early-'+mode};currentState=state;state.foundation=new Foundation(state,{project:${JSON.stringify(project)},file:${JSON.stringify(composePath)},environment:process.env,
runner:(cmd,args,options)=>{if(operation==='temporary-inspect'&&createdTemporaryId&&args[0]==='inspect'&&args[1]===createdTemporaryId)return{status:1,stdout:'',stderr:'isolated first inspect failure'};
if(args[0]==='stop'){stops++;
if(['init','migrate','dev-early'].includes(operation))return{status:1,stdout:'',stderr:'isolated cleanup failure'};
if(operation==='temporary'&&temporaryActive)return{status:0,stdout:'',stderr:''};
const result=spawnSync(cmd,args,options);if(armed&&(restarts===0&&operation.startsWith('pause-')||operation==='gateway-pause'&&args.at(-1)===gatewayId)){const restarted=spawnSync(cmd,['start',args.at(-1)],options);if(restarted.status!==0)throw Error('restart failed');restarts++}return result}
return spawnSync(cmd,args,options)}});state.foundation.waitPostgres=async()=>{};
const compose=state.foundation.compose.bind(state.foundation),call=state.foundation.call.bind(state.foundation);
state.foundation.compose=(args,...rest)=>{if(['init','migrate'].includes(operation)&&args[0]==='run')throw new LocalError('DISPOSABLE_MIGRATION_FAILURE');
if(operation.startsWith('temporary')&&args.includes('dist/cli/integration-check.js'))return{status:0,stdout:''};
const result=compose(args,...rest);if(operation.startsWith('temporary')&&args[0]==='run'&&args.includes('-d')){
createdTemporaryId=result.stdout.trim();atomicJson(join(directory,'creation-receipt.json'),{id:createdTemporaryId,name:args[args.indexOf('--name')+1],runId:readJson(join(directory,'mode-lock.json')).runId})}return result};
state.foundation.call=(args,...rest)=>{if(operation.startsWith('temporary')&&args[0]==='cp'){temporaryActive=true;throw new LocalError('DISPOSABLE_BOOTSTRAP_FAILURE')}return call(args,...rest)};return state};
const context={directory,gatewayTemplate,valuesFor:()=>({}),assertHosts:async()=>{},externalCheck:()=>{},control:async()=>false,runtime:make,
initialized:state=>{const record=readJson(join(directory,'initialized.json'));state.foundation.preflight(true,record.volumes);return record},
dev:{tools:{node:process.execPath},assertPorts:async()=>{},writeGateway:()=>{},specifications:[],checkPrepared:async()=>{if(operation==='gateway-pause')return false;throw new LocalError('DISPOSABLE_EARLY_DEV_FAILURE')},
prepare:async()=>{prepared++;throw new LocalError('DISPOSABLE_UNEXPECTED_PREPARE')},readiness:async()=>{
if(operation!=='gateway-pause')return;armed=true;gatewayId=currentState.foundation.containers().find(x=>x.Config.Labels['com.docker.compose.service']==='gateway').Id;
const owner=readJson(join(directory,'mode-lock.json'));atomicJson(join(directory,'control-request.json'),{action:'bootstrap',mode,runId:owner.runId,fingerprint:owner.fingerprint,requestId:randomUUID(),adminUserId:randomUUID()})}}};
try{if(operation.startsWith('pause-')||operation.startsWith('temporary')){
const state=make(),lock=acquireLock({mode,fingerprint:state.fingerprint,directory});state.foundation.preflight(true);
await state.foundation.start(['postgres','server','web','outline','gateway'],{onChange:resources=>lock.update({resources})});
lock.update({persistent:true,state:'ready',preparedVolumes:state.foundation.verifyVolumes(),gatewayDigest:digest(${JSON.stringify('isolated pause and early cleanup gateway')}),
managedApplications:[...state.foundation.started.values()].filter(x=>['server','web','outline','gateway'].includes(x.service))});
if(operation==='temporary-write'){const update=lock.update;lock.update=extra=>{if(extra.temporaryContainer)throw new LocalError('DISPOSABLE_FIRST_REFERENCE_WRITE_FAILURE');update(extra)}}
await prepareFullRuntime(state,lock,'explicit-fixture-user',operation.startsWith('temporary')?{gatewayDigest:()=>lock.record.gatewayDigest}:{gatewayDigest:()=>lock.record.gatewayDigest,
prepare:async()=>{prepared++},ready:async()=>{armed=true;throw new LocalError('DISPOSABLE_RESUME_FAILURE')}});
}else await legacyCommand(['dev-early','gateway-pause'].includes(operation)?'dev':operation,mode,undefined,context);
console.log('DISPOSABLE_SUCCESS');process.exitCode=0}catch(error){console.log(error.code??error.message);process.exitCode=9}
finally{console.log(JSON.stringify({operation,mode,stops,restarts,prepared}))}
`)
  const results = [], invoke = (operation, mode) => {
    const result = spawnSync(process.execPath, [childPath, operation, mode], { encoding: 'utf8', windowsHide: true, timeout: 110000 })
    const proof = JSON.parse(result.stdout.split(/\r?\n/).find(line => line.startsWith('{"operation"')) ?? 'null')
    console.log(result.stdout + result.stderr); results.push({ ...proof, exit: result.status }); return { ...result, proof }
  }
  const lockPath = join(directory, 'mode-lock.json'), initializedPath = join(directory, 'initialized.json')
  try {
    await foundation.start(['redis'])
    const independentId = [...foundation.started.keys()][0]
    foundation.call(['exec', independentId, 'node', '-e', "require('fs').writeFileSync('/data/marker','early-preserved')"])
    const initialVolumes = foundation.verifyVolumes(false)
    assert.equal(initialVolumes.length, 1)
    for (const [operation, mode] of [['init', 'dev'], ['migrate', 'full'], ['dev-early', 'dev'], ['pause-initial', 'full'], ['pause-resume', 'full'], ['gateway-pause', 'dev'],
      ['temporary-clean', 'full'], ['temporary', 'full'], ['temporary-write', 'full'], ['temporary-inspect', 'full']]) {
      if (operation === 'migrate') rmSync(initializedPath, { force: true })
      const failed = invoke(operation, mode)
      assert.equal(failed.status, 9)
      const retained = JSON.parse(readFileSync(lockPath, 'utf8')), original = structuredClone(retained)
      assert.equal(retained.cleanupRequired, operation !== 'temporary-clean')
      assert.equal(retained.state, operation === 'temporary-clean' ? 'preparation-failed' : 'cleanup-failed')
      assert.ok(retained.resources.started.length > 0)
      const volumes = foundation.verifyVolumes()
      assert.deepEqual(retained.preparedVolumes, volumes)
      for (const proof of retained.resources.containerProofs) foundation.verifyRecordedContainer(foundation.inspect(proof.id), proof)
      if (['init', 'migrate'].includes(operation)) {
        assert.equal(existsSync(initializedPath), false); assert.equal(retained.preparation.command, operation)
        assert.equal(retained.preparation.partial, true); assert.equal(retained.preparation.secretFingerprint, digest({}))
        assert.equal(volumes.length, 2)
      }
      if (operation.startsWith('pause-')) {
        assert.equal(failed.proof.restarts, 1)
        assert.equal(failed.proof.prepared, operation === 'pause-initial' ? 0 : 1)
      }
      if (operation === 'gateway-pause') { assert.equal(failed.proof.restarts, 2); assert.equal(failed.proof.prepared, 0) }
      if (operation === 'temporary') {
        assert.ok(retained.temporaryContainer); const actual = foundation.inspect(retained.temporaryContainer)
        assert.equal(actual.State.Running, true)
        assert.deepEqual(retained.temporaryProof, foundation.containerProof(actual))
        assert.equal(actual.Image, retained.temporaryExpectedImage)
      }
      if (operation === 'temporary-clean') {
        const receipt = JSON.parse(readFileSync(join(directory, 'creation-receipt.json'), 'utf8'))
        assert.equal(foundation.inspect(receipt.id), null); assert.equal(retained.temporaryContainer, null); assert.equal(retained.temporaryName, null)
      }
      for (const selected of ['dev', 'full']) {
        const refused = invoke(selected === 'dev' ? 'dev' : 'up', selected)
        assert.equal(refused.status, 9); assert.equal(refused.proof.stops, 0)
        assert.equal(JSON.parse(readFileSync(lockPath, 'utf8')).runId, retained.runId)
      }
      if (operation === 'temporary') {
        const unknown = foundation.call(['create', '--label', `com.docker.compose.project=${project}`, images.node, 'node', '--version']).stdout.trim()
        const unknownRefused = invoke('down', mode); assert.equal(unknownRefused.status, 9); assert.equal(unknownRefused.proof.stops, 0)
        foundation.call(['rm', unknown])
        const proof = structuredClone(retained.temporaryProof)
        retained.temporaryProof.digest = 'changed'; writeFileSync(lockPath, JSON.stringify(retained))
        const refused = invoke('down', mode); assert.equal(refused.status, 9); assert.equal(refused.proof.stops, 0)
        retained.temporaryProof = proof; writeFileSync(lockPath, JSON.stringify(retained))
      }
      if (operation === 'init') {
        const unknownVolume = `${project}_foreign`
        foundation.call(['volume', 'create', '--label', `com.docker.compose.project=${project}`, unknownVolume])
        const refused = invoke('down', mode); assert.equal(refused.status, 9); assert.equal(refused.proof.stops, 0)
        foundation.call(['volume', 'rm', unknownVolume])
      }
      if (['temporary-write', 'temporary-inspect'].includes(operation)) {
        const receipt = JSON.parse(readFileSync(join(directory, 'creation-receipt.json'), 'utf8')), actual = foundation.inspect(receipt.id)
        assert.equal(retained.temporaryName, receipt.name); assert.equal(retained.runId, receipt.runId)
        assert.equal(actual.Image, retained.temporaryExpectedImage); assert.equal(actual.State.Running, true)
        assert.equal(actual.Config.Labels['dev.exwebsite.run'], retained.runId)
        assert.equal(actual.Config.Labels['com.docker.compose.project'], project)
        assert.equal(retained.temporaryProof, undefined)
        if (operation === 'temporary-write') assert.equal(retained.temporaryContainer, undefined)
        else assert.equal(retained.temporaryContainer, receipt.id)
        const refused = invoke('down', mode); assert.equal(refused.status, 9); assert.equal(refused.proof.stops, 0)
        assert.match(refused.stdout, /TEMPORARY_CONTAINER_PROOF_MISSING/)
        // Only the fixture's independent receipt of its actual create command
        // authorizes this manual teardown. It is never inserted into recovery.
        foundation.call(['stop', '--time', '10', receipt.id]); assert.equal(foundation.inspect(receipt.id), null)
        console.log(JSON.stringify({ operation, manualFixtureTemporaryCleanup: receipt.id, productRefusedToResampleProof: true }))
      }
      assert.equal(invoke('down', mode).status, 0); assert.equal(invoke('down', mode).status, 0)
      assert.equal(existsSync(lockPath), false)
      for (const item of original.resources.started) assert.equal(foundation.inspect(item.id)?.State.Running ?? false, false)
      if (original.temporaryContainer) assert.equal(foundation.inspect(original.temporaryContainer), null)
      assert.equal(foundation.inspect(independentId).State.Running, true)
      assert.equal(foundation.call(['exec', independentId, 'node', '-e', "process.stdout.write(require('fs').readFileSync('/data/marker','utf8'))"]).stdout, 'early-preserved')
      assert.deepEqual(foundation.verifyVolumes(), volumes)
      for (const actual of foundation.containers()) if (actual.Id !== independentId) foundation.call(['rm', actual.Id])
      for (const name of ['mode.json', 'retired-legacy-run.json', 'creation-receipt.json']) rmSync(join(directory, name), { force: true })
      writeFileSync(initializedPath, JSON.stringify({ version: 1, secretFingerprint: digest({}), volumes }))
    }
    console.log(JSON.stringify({ project, results, firstInitKnownVolumeGrowth: [initialVolumes.length, foundation.verifyVolumes().length],
      exactTemporaryProofAndFreshDown: true, actualSameIdRestart: true, ordinarySameCrossModeRefused: true,
      actualDefaultServerBuildOnly: true, precreateTrustedBuiltImage: true, missingCreationProofRefusedAutomaticRecovery: true,
      independentId, markerPreserved: true, volumes: foundation.verifyVolumes() }))
  } finally {
    foundation.compose(['down', '--volumes', '--remove-orphans'], true)
    const ownedImages = foundation.call(['image', 'ls', '--no-trunc', '--filter', `label=dev.exwebsite.fixture=${project}`, '--format', '{{.ID}}']).stdout.trim().split(/\r?\n/).filter(Boolean)
    for (const id of new Set(ownedImages)) {
      const actual = JSON.parse(foundation.call(['image', 'inspect', id]).stdout)[0]
      assert.equal(actual.Config.Labels['dev.exwebsite.fixture'], project)
      assert.equal(beforeImages.some(item => item.startsWith(id + ' ')), false)
      foundation.call(['image', 'rm', id])
    }
    const afterImages = foundation.call(['image', 'ls', '--no-trunc', '--format', '{{.ID}} {{.Repository}}:{{.Tag}}']).stdout.trim().split(/\r?\n/)
    assert.equal(beforeImages.every(item => afterImages.includes(item)), true)
    const after = foundation.call(['ps', '-a', '--format', '{{.ID}} {{.Names}}']).stdout.trim().split(/\r?\n/)
    assert.equal(before.every(item => after.includes(item)), true); assert.equal(after.some(item => item.includes(project)), false)
    console.log(JSON.stringify({ project, beforeContainers: before, afterContainers: after, originalImagesPreserved: true, removedOwnImages: ownedImages, cleaned: true }))
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('legacy production CLI failure exits and fresh dev/full down restores exact ownership, rejects faults and preserves independent data', { timeout: 500000 }, async () => {
  const workspace = mkdtempSync(join(root, '.local/docs-integration/legacy-cli-real-')), project = `exwebsite-legacy-test-${randomUUID().slice(0, 8)}`
  const images = JSON.parse(readFileSync(join(root, 'infra/docs-integration/images.lock.json'), 'utf8'))
  const composePath = join(workspace, 'compose.json'), gatewayPath = join(workspace, 'gateway.template'), directory = join(workspace, 'control')
  mkdirSync(directory); writeFileSync(gatewayPath, 'disposable CLI gateway fingerprint')
  const services = Object.fromEntries(['postgres', 'redis', 'hydra', 'server', 'web', 'outline', 'gateway'].map(service => [service, {
    image: images.node, entrypoint: ['node'], command: ['-e', 'process.on("SIGTERM",()=>process.exit(0));setInterval(()=>{},1000)'],
    volumes: ['data:/data'] }]))
  writeFileSync(composePath, JSON.stringify({ services, volumes: { data: {} } }))
  const baseState = { workspace, fingerprint: 'fixture-cli-target' }
  const foundation = new Foundation(baseState, { project, file: composePath, environment: process.env }); foundation.waitPostgres = async () => {}
  const beforeContainers = foundation.call(['ps', '-a', '--format', '{{.ID}} {{.Names}}']).stdout.trim().split(/\r?\n/).filter(Boolean)
  const childFile = join(workspace, 'cli.mjs'), moduleUrl = name => pathToFileURL(join(root, 'scripts/docs-integration', name)).href
  writeFileSync(childFile, `import{legacyCommand}from ${JSON.stringify(moduleUrl('legacy.mjs'))};
import{Foundation}from ${JSON.stringify(moduleUrl('foundation.mjs'))};import{atomicJson,readJson,LocalError}from ${JSON.stringify(moduleUrl('local-config.mjs'))};
import{spawnSync}from'node:child_process';import{join}from'node:path';
const[command,mode,fault]=process.argv.slice(2),directory=${JSON.stringify(directory)},workspace=${JSON.stringify(workspace)};let stops=0,writes=0;
const make=()=>{const state={workspace,mode,fingerprint:'fixture-cli-'+mode};state.foundation=new Foundation(state,{project:${JSON.stringify(project)},file:${JSON.stringify(composePath)},environment:process.env,
runner:(cmd,args,options)=>{if(args[0]==='stop'&&++stops===Number(fault?.replace('stop','')))return{status:1,stdout:'',stderr:'disposable stop fault'};
if(fault==='inspect'&&args[0]==='inspect')return{status:1,stdout:'',stderr:'disposable inspect fault'};
if(fault==='inventory'&&args[0]==='ps')return{status:1,stdout:'',stderr:'disposable inventory fault'};return spawnSync(cmd,args,options)}});
state.foundation.waitPostgres=async()=>{};return state};
const context={directory,gatewayTemplate:${JSON.stringify(gatewayPath)},valuesFor:()=>({}),assertHosts:async()=>{},externalCheck:()=>{},control:async()=>false,runtime:make,
initialized:state=>{const record=readJson(join(directory,'initialized.json'));state.foundation.preflight(true,record.volumes);return record},
persist:(path,value)=>{if(++writes===Number(fault?.replace('write','')))throw new LocalError('DISPOSABLE_WRITE_FAULT');atomicJson(path,value)},
fullUp:{build:()=>{},check:()=>{},verifyClients:async()=>{},ready:async()=>{throw new LocalError('DISPOSABLE_READY_FAULT')}},
dev:{tools:{node:process.execPath},assertPorts:async()=>{},writeGateway:()=>{},checkPrepared:async()=>true,readiness:async()=>{},
specifications:[{name:'fixture',command:process.execPath,args:['-e','setTimeout(()=>process.exit(7),1500)'],cwd:workspace,environment:process.env}]}};
try{await legacyCommand(command,mode,undefined,context);console.log('DISPOSABLE_CLI_SUCCESS');process.exitCode=0}
catch(error){console.log(error.code??error.message);process.exitCode=9}
finally{console.log(JSON.stringify({productionCliCommand:command,mode,fault,stopCalls:stops,writes}))}
`)
  const exits = []
  const invoke = (command, mode, fault = '') => {
    const result = spawnSync(process.execPath, [childFile, command, mode, fault], { encoding: 'utf8', windowsHide: true, timeout: 90000 })
    const proof = JSON.parse(result.stdout.split(/\r?\n/).find(line => line.startsWith('{"productionCliCommand"')) ?? 'null')
    console.log(result.stdout + result.stderr); exits.push({ command, mode, fault, exit: result.status, proof }); return { ...result, proof }
  }
  const recordFile = join(directory, 'mode-lock.json'), modeFile = join(directory, 'mode.json')
  let unknown
  try {
    await foundation.start(['redis'])
    const redisId = [...foundation.started.keys()][0], volumes = foundation.verifyVolumes()
    foundation.call(['exec', redisId, 'node', '-e', "require('fs').writeFileSync('/data/marker','preserved')"])
    writeFileSync(join(directory, 'initialized.json'), JSON.stringify({ version: 1, secretFingerprint: digest({}), volumes }))
    for (const mode of ['full', 'dev']) {
      assert.equal(invoke(mode === 'full' ? 'up' : 'dev', mode, 'stop1').status, 9)
      let failed = JSON.parse(readFileSync(recordFile, 'utf8'))
      assert.equal(failed.state, 'cleanup-failed'); assert.equal(failed.persistent, undefined)
      assert.ok(failed.resources.containerProofs.some(item => item.id === redisId))
      const ids = foundation.containers().map(item => item.Id).sort()
      for (const [command, selectedMode] of [[mode === 'full' ? 'up' : 'dev', mode], ['down', mode === 'full' ? 'dev' : 'full']]) {
        const rejected = invoke(command, selectedMode); assert.equal(rejected.status, 9); assert.equal(rejected.proof.stopCalls, 0)
      }
      for (const fault of ['inspect', 'inventory', 'write1', 'stop1', 'stop2', 'write2', 'write3']) {
        const rejected = invoke('down', mode, fault); assert.equal(rejected.status, 9)
        if (['inspect', 'inventory', 'write1', 'write2'].includes(fault)) assert.equal(rejected.proof.stopCalls, 0)
        assert.equal(existsSync(recordFile), true)
        assert.deepEqual(foundation.containers().map(item => item.Id).sort(), ids)
      }
      const owner = failed.resources.started.find(item => item.service === 'postgres')
      foundation.call(['update', '--restart', 'always', owner.id])
      let rejected = invoke('down', mode); assert.equal(rejected.status, 9); assert.equal(rejected.proof.stopCalls, 0)
      foundation.call(['update', '--restart', 'no', owner.id])
      const receipt = readFileSync(recordFile)
      for (const fault of ['live-owner', 'fingerprint', 'missing-proof']) {
        const changed = JSON.parse(receipt)
        if (fault === 'live-owner') changed.identity = processIdentity(process.pid)
        if (fault === 'fingerprint') changed.fingerprint = 'changed'
        if (fault === 'missing-proof') { changed.resources.containerProofs = []; if (changed.recovery) changed.recovery.resources.containerProofs = [] }
        writeFileSync(recordFile, JSON.stringify(changed))
        rejected = invoke('down', mode); assert.equal(rejected.status, 9); assert.equal(rejected.proof.stopCalls, 0)
        writeFileSync(recordFile, receipt)
      }
      unknown = foundation.call(['create', '--label', `com.docker.compose.project=${project}`, images.node, 'node', '--version']).stdout.trim()
      rejected = invoke('down', mode); assert.equal(rejected.status, 9); assert.equal(rejected.proof.stopCalls, 0)
      foundation.call(['rm', unknown]); unknown = undefined
      assert.equal(invoke('down', mode).status, 0); assert.equal(invoke('down', mode).status, 0)
      assert.equal(existsSync(recordFile), false)
      assert.equal(foundation.inspect(redisId).State.Running, true)
      assert.equal(foundation.call(['exec', redisId, 'node', '-e', "process.stdout.write(require('fs').readFileSync('/data/marker','utf8'))"]).stdout, 'preserved')
      assert.deepEqual(foundation.verifyVolumes(), volumes)
      // Retire only this test's stopped applications between independent modes;
      // the production down above never removes containers or volumes.
      for (const container of foundation.containers()) if (container.Id !== redisId) foundation.call(['rm', container.Id])
      rmSync(modeFile); rmSync(join(directory, 'retired-legacy-run.json'))
    }
    console.log(JSON.stringify({ project, productionLegacyCommandFreshProcesses: true, exits, independentRedis: redisId,
      markerPreserved: true, volumes, fullNonpersistentAndDevCleanupRecovered: true, actualNodeFixtureApplications: true }))
  } finally {
    if (unknown) foundation.call(['rm', unknown], true)
    foundation.compose(['down', '--volumes', '--remove-orphans'], true)
    const afterContainers = foundation.call(['ps', '-a', '--format', '{{.ID}} {{.Names}}']).stdout.trim().split(/\r?\n/).filter(Boolean)
    assert.equal(beforeContainers.every(item => afterContainers.includes(item)), true)
    assert.equal(afterContainers.some(item => item.includes(project)), false)
    console.log(JSON.stringify({ project, beforeContainers, afterContainers, cleaned: true }))
    rmSync(workspace, { recursive: true, force: true })
  }
})

async function unusedPort() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port
}
function gatewayResponse(port, path, host = 'exwebsite.test') {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port, path, headers: { Host: host } }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk })
      response.on('end', () => resolve({ status: response.statusCode, body })); response.on('error', reject)
    })
    request.setTimeout(2000, () => request.destroy(new Error('gateway smoke timeout')))
    request.on('error', reject); request.end()
  })
}
test('actual legacy Compose dev verifier and managed bidirectional transitions preserve volumes/data and independent services', { timeout: 300000 }, async () => {
  const workspace = mkdtempSync(join(root, '.local/docs-integration/legacy-real-')), project = `exwebsite-legacy-test-${randomUUID().slice(0, 8)}`
  const ports = { postgres: await unusedPort(), redis: await unusedPort(), admin: await unusedPort(), gateway: await unusedPort() }
  const secrets = Object.fromEntries([...secretNames, 'EXRE_PASSWORD', 'AUTH_CODE_HMAC_KEY', 'OIDC_PROBE_CLIENT_SECRET'].map(key => [key, randomBytes(32).toString('hex')]))
  const images = JSON.parse(readFileSync('infra/docs-integration/images.lock.json', 'utf8'))
  const values = { ...process.env, ...secrets, EXUI_BUILD_CONTEXT: join(root, '.local/docs-integration/exui-context'),
    WEBSITE_SERVER_UPSTREAM: 'host.docker.internal:18080', WEBSITE_WEB_UPSTREAM: 'host.docker.internal:18081',
    OUTLINE_BACKEND_UPSTREAM: 'host.docker.internal:13102', OUTLINE_STATIC_UPSTREAM: 'host.docker.internal:13101', OUTLINE_STATIC_PREFIX: '' }
  let dev, full, unknownId
  try {
    for (const path of ['compose.yaml', 'compose.dev.yaml', 'compose.full.yaml', 'infra/docs-integration/postgres/init.sh']) {
      const target = join(workspace, path); mkdirSync(join(target, '..'), { recursive: true }); cpSync(join(root, path), target)
    }
    writeFileSync(join(workspace, 'compose.yaml'), readFileSync(join(workspace, 'compose.yaml'), 'utf8').replace('127.0.0.1:14445:4445', `127.0.0.1:${ports.admin}:4445`).replace('127.0.0.1:8090:8090', `127.0.0.1:${ports.gateway}:8090`))
    writeFileSync(join(workspace, 'compose.dev.yaml'), readFileSync(join(workspace, 'compose.dev.yaml'), 'utf8').replace('127.0.0.1:16432:5432', `127.0.0.1:${ports.postgres}:5432`).replace('127.0.0.1:16379:6379', `127.0.0.1:${ports.redis}:6379`))
    const gatewayPath = join(workspace, 'gateway.template')
    const initPath = join(workspace, 'runtime-init.sh'); writeFileSync(initPath, legacyInitRecipe(readFileSync(join(root, 'infra/docs-integration/postgres/init.sh'), 'utf8')))
    writeFileSync(gatewayPath, readFileSync(join(root, 'infra/docs-integration/gateway/default.conf.template'), 'utf8'))
    const fixture = join(root, 'tests/dev/fixture-process.mjs')
    const make = mode => {
      const services = legacyRuntimeServices(mode, { gatewayPath, initPath, recipePath: join(root, '.local/docs-integration/Dockerfile.website-runtime'), postgresPort: ports.postgres, redisPort: ports.redis })
      // Real full service definitions are resolved/created. Their application
      // images alone use short disposable fixtures; this is topology proof,
      // not acceptance of the production Website/Outline applications.
      if (mode === 'full') for (const service of ['server', 'web', 'outline']) {
        Object.assign(services[service], { image: images.node, entrypoint: ['node'], command: ['/fixture.mjs', 'wait'],
          volumes: [{ type: 'bind', source: fixture, target: '/fixture.mjs', read_only: true }] })
      }
      const overlay = join(workspace, `${mode}.json`); writeFileSync(overlay, JSON.stringify({ services }))
      const environment = { ...values, ...(mode === 'full' ? { WEBSITE_SERVER_UPSTREAM: 'server:8080', WEBSITE_WEB_UPSTREAM: 'web:80', OUTLINE_BACKEND_UPSTREAM: 'outline:3000', OUTLINE_STATIC_UPSTREAM: 'outline:3000' } : {}) }
      const state = { workspace, fingerprint: digest({ mode, secrets }), mode }
      const runner = (command, args, options) => {
        const result = spawnSync(command, args, options)
        if (args.includes('up') && result.status !== 0) console.log(redact(result.stdout + result.stderr, secrets))
        return result
      }
      state.foundation = new Foundation(state, { project, file: 'compose.yaml', overlays: [`compose.${mode}.yaml`, overlay], environment, runner })
      return state
    }
    dev = make('dev'); full = make('full')
    assert.equal(dev.foundation.configuration().services.server, undefined)
    assert.ok(dev.foundation.configuration({ preparation: true }).services.verifier)
    assert.equal(dev.foundation.hash('postgres'), full.foundation.hash('postgres'))
    assert.equal(dev.foundation.hash('redis'), full.foundation.hash('redis'))
    const beforeContainers = dev.foundation.call(['ps', '-a', '--format', '{{.ID}} {{.Names}}']).stdout.trim().split(/\r?\n/).filter(Boolean)
    dev.foundation.preflight(false); await dev.foundation.start(['postgres', 'redis'])
    dev.foundation.compose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-c', "CREATE TABLE task3_preservation(value text); INSERT INTO task3_preservation VALUES ('stable')"])
    const volumes = dev.foundation.verifyVolumes(), initialIds = dev.foundation.containers().map(container => container.Id).sort()
    await dev.foundation.stopStarted()
    const initRegistry = { stoppedAt: new Date().toISOString(), resources: dev.foundation.snapshot() }
    transitionStoppedApplications(full, initRegistry, volumes)
    full.foundation.preflight(true, volumes); await full.foundation.start(['postgres', 'redis'])
    full.foundation.compose(['run', '--rm', '--no-deps', 'hydra', 'migrate', 'sql', 'up', '--read-from-env', '--yes'])
    await full.foundation.start(['hydra'])
    // Earn normal started history; Compose create has zero StartedAt and its
    // never-started proof cannot authorize the later ordinary restart negative.
    await full.foundation.start(['server', 'web', 'outline', 'gateway'])
    for (const container of full.foundation.containers()) assert.ok(Date.parse(container.State.StartedAt) > 0)
    await full.foundation.stopStarted()
    const fullRegistry = { stoppedAt: new Date().toISOString(), resources: full.foundation.snapshot() }
    const beforeSwitch = full.foundation.containers().map(container => container.Id).sort()
    const missingProof = { ...fullRegistry, resources: { ...fullRegistry.resources, containerProofs: [] } }
    assert.throws(() => transitionStoppedApplications(dev, missingProof, volumes), /OWNERSHIP_CONFLICT/)
    assert.deepEqual(full.foundation.containers().map(container => container.Id).sort(), beforeSwitch)
    const gatewayId = full.foundation.containers().find(container => container.Config.Labels['com.docker.compose.service'] === 'gateway').Id
    assert.throws(() => transitionStoppedApplications(full, { ...fullRegistry, resources: { ...fullRegistry.resources,
      started: fullRegistry.resources.started.filter(item => item.id !== gatewayId) } }, volumes), /OWNER_UNKNOWN/)
    console.log(JSON.stringify({ phase: 'earned-stopped-history', applications: full.foundation.containers().filter(c => ['server', 'web', 'outline', 'gateway'].includes(c.Config.Labels['com.docker.compose.service'])).map(c => ({ id: c.Id, service: c.Config.Labels['com.docker.compose.service'], running: c.State.Running, startedAt: c.State.StartedAt })) }))
    await full.foundation.start(['server'])
    assert.throws(() => transitionStoppedApplications(dev, fullRegistry, volumes), /RESTARTED|OWNERSHIP_CONFLICT/)
    assert.deepEqual(full.foundation.containers().map(container => container.Id).sort(), beforeSwitch)
    await full.foundation.stopStarted()
    fullRegistry.resources = full.foundation.snapshot()
    unknownId = full.foundation.call(['create', '--label', `com.docker.compose.project=${project}`, '--label', 'com.docker.compose.service=postgres', '--label', 'com.docker.compose.oneoff=False', images.node, 'node', '--version']).stdout.trim()
    assert.throws(() => transitionStoppedApplications(dev, fullRegistry, volumes), /OWNERSHIP_CONFLICT/)
    assert.deepEqual(full.foundation.containers().filter(container => container.Id !== unknownId).map(container => container.Id).sort(), beforeSwitch)
    full.foundation.call(['rm', unknownId]); unknownId = undefined
    assert.equal(transitionStoppedApplications(dev, fullRegistry, volumes).length, 4)
    dev.foundation.preflight(true, volumes); await dev.foundation.start(['postgres', 'redis', 'hydra', 'gateway'])
    const gateway = dev.foundation.containers().find(container => container.Config.Labels['com.docker.compose.service'] === 'gateway')
    await pauseContainers(dev, [{ id: gateway.Id, service: 'gateway' }])
    assert.equal((await prepareHydraWithoutGateway(dev, randomUUID())).status, 0)
    assert.equal(dev.foundation.inspect(gateway.Id).State.Running, false)
    assert.equal(dev.foundation.containers().some(container => container.Config.Labels['com.docker.compose.service'] === 'verifier'), false)
    const client = await fetch(`http://127.0.0.1:${ports.admin}/admin/clients/ex-outline`).then(response => response.json())
    assert.equal(client.metadata.issuer, 'http://identity.exwebsite.test:8090/')
    const failed = { ...dev, foundation: new Foundation(dev, { project, file: 'compose.yaml', overlays: ['compose.dev.yaml', join(workspace, 'dev.json')], environment: { ...values, OUTLINE_OIDC_CLIENT_SECRET: randomBytes(32).toString('hex') } }) }
    await assert.rejects(prepareHydraWithoutGateway(failed, randomUUID()), /LEGACY_HYDRA_PREPARE_FAILED/)
    assert.equal(dev.foundation.inspect(gateway.Id).State.Running, false)
    assert.equal(dev.foundation.containers().some(container => container.Config.Labels['com.docker.compose.service'] === 'verifier'), false)
    await dev.foundation.start(['gateway']); assert.equal(dev.foundation.inspect(gateway.Id).State.Running, true)
    await dev.foundation.stopStarted()
    assert.equal(transitionStoppedApplications(full, { stoppedAt: new Date().toISOString(), resources: dev.foundation.snapshot() }, volumes).length, 1)
    full.foundation.preflight(true, volumes); await full.foundation.start(['postgres', 'redis'])
    const independent = make('full'); independent.foundation.preflight(true, volumes)
    assert.equal(independent.foundation.preRunning.size, 2)
    await independent.foundation.start(['hydra']); await independent.foundation.stopStarted()
    assert.deepEqual(independent.foundation.containers().filter(container => container.State.Running).map(container => container.Config.Labels['com.docker.compose.service']).sort(), ['postgres', 'redis'])
    assert.equal(full.foundation.compose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-At', '-c', 'SELECT value FROM task3_preservation']).stdout.trim(), 'stable')
    assert.deepEqual(full.foundation.verifyVolumes(), volumes)
    assert.equal(initialIds.every(id => full.foundation.inspect(id)), true)
    // Deliberate HostConfig tampering is last: Docker update can change other
    // persisted defaults, so changing restart back is not an identity restore.
    full.foundation.compose(['create', '--no-build', 'server'])
    const ownedServer = full.foundation.containers().find(container => container.Config.Labels['com.docker.compose.service'] === 'server')
    full.foundation.verifyContainer(ownedServer, 'server')
    full.foundation.started.set(ownedServer.Id, { id: ownedServer.Id, service: 'server' })
    const finalRegistry = { stoppedAt: new Date().toISOString(), resources: full.foundation.snapshot() }
    const beforeTamper = full.foundation.containers().map(container => container.Id).sort()
    full.foundation.call(['update', '--restart', 'always', ownedServer.Id])
    assert.throws(() => transitionStoppedApplications(dev, finalRegistry, volumes), /STOPPED_CONTAINER_OWNERSHIP_CONFLICT/)
    assert.deepEqual(full.foundation.containers().map(container => container.Id).sort(), beforeTamper)
    console.log(JSON.stringify({ project, stableFoundationHashes: true, devInitToFullAndDev: true, bidirectionalSwitch: true,
      unknownStoppedAndChangedOwnedZeroMutation: true, verifierActualSuccessFailureCleanup: true, gatewayPausedThenRestored: true,
      initialIds, independentPreRunning: [...independent.foundation.preRunning.keys()], volumes, beforeContainers }))
  } finally {
    if (unknownId) full.foundation.call(['rm', unknownId], true)
    dev?.foundation.compose(['down', '--volumes', '--remove-orphans'], true)
    assert.equal(dev?.foundation.containers().length ?? 0, 0)
    const afterContainers = dev?.foundation.call(['ps', '-a', '--format', '{{.ID}} {{.Names}}']).stdout.trim().split(/\r?\n/).filter(Boolean) ?? []
    console.log(JSON.stringify({ project, cleaned: true, afterContainers }))
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('production full-up failure lifecycle persists exact recovery before release and retries with real isolated containers', { timeout: 500000 }, async () => {
  const workspace = mkdtempSync(join(root, '.local/docs-integration/full-failure-real-')), project = `exwebsite-legacy-test-${randomUUID().slice(0, 8)}`
  const ports = { postgres: await unusedPort(), redis: await unusedPort(), admin: await unusedPort(), gateway: await unusedPort(), web: await unusedPort() }
  assert.equal(new Set(Object.values(ports)).size, 5)
  const secrets = Object.fromEntries([...secretNames, 'EXRE_PASSWORD', 'AUTH_CODE_HMAC_KEY', 'OIDC_PROBE_CLIENT_SECRET'].map(key => [key, randomBytes(32).toString('hex')]))
  const images = JSON.parse(readFileSync('infra/docs-integration/images.lock.json', 'utf8'))
  const environment = { ...process.env, ...secrets, EXUI_BUILD_CONTEXT: join(root, '.local/docs-integration/exui-context'),
    WEBSITE_SERVER_UPSTREAM: 'server:8080', WEBSITE_WEB_UPSTREAM: 'web:80', OUTLINE_BACKEND_UPSTREAM: 'outline:3000', OUTLINE_STATIC_UPSTREAM: 'outline:3000', OUTLINE_STATIC_PREFIX: '' }
  const modeRecordPath = join(workspace, 'mode.json'), directory = join(workspace, 'owner'), fingerprint = digest({ project, fixture: 'full-failure' })
  let foundation, blockerId, retainedLock
  const beforeContainers = new Foundation({ workspace: root, fingerprint }, { project, environment }).call(['ps', '-a', '--format', '{{.ID}} {{.Names}}']).stdout.trim().split(/\r?\n/).filter(Boolean)
  try {
    for (const path of ['compose.yaml', 'compose.dev.yaml', 'compose.full.yaml']) cpSync(join(root, path), join(workspace, path))
    writeFileSync(join(workspace, 'compose.yaml'), readFileSync(join(workspace, 'compose.yaml'), 'utf8').replace('127.0.0.1:14445:4445', `127.0.0.1:${ports.admin}:4445`).replace('127.0.0.1:8090:8090', `127.0.0.1:${ports.gateway}:8090`))
    writeFileSync(join(workspace, 'compose.dev.yaml'), readFileSync(join(workspace, 'compose.dev.yaml'), 'utf8').replace('127.0.0.1:16432:5432', `127.0.0.1:${ports.postgres}:5432`).replace('127.0.0.1:16379:6379', `127.0.0.1:${ports.redis}:6379`))
    const gatewayPath = join(workspace, 'gateway.template'), initPath = join(workspace, 'runtime-init.sh'), overlay = join(workspace, 'full.json')
    writeFileSync(gatewayPath, awaitingGatewayTemplate(readFileSync(join(root, 'infra/docs-integration/gateway/default.conf.template'), 'utf8')))
    writeFileSync(initPath, legacyInitRecipe(readFileSync(join(root, 'infra/docs-integration/postgres/init.sh'), 'utf8')))
    const services = legacyRuntimeServices('full', { gatewayPath, initPath, recipePath: join(root, '.local/docs-integration/Dockerfile.website-runtime'), postgresPort: ports.postgres, redisPort: ports.redis })
    for (const service of ['server', 'web', 'outline']) Object.assign(services[service], { image: images.node, entrypoint: ['node'],
      command: ['-e', 'process.on("SIGTERM",()=>process.exit(0));setInterval(()=>{},1000)'] })
    services.server.command = ['-e', 'require("node:http").createServer((req,res)=>{res.setHeader("Content-Type","application/json");res.end(JSON.stringify({fixtureApi:true,path:req.url}))}).listen(8080);process.on("SIGTERM",()=>process.exit(0))']
    services.web.ports = [`127.0.0.1:${ports.web}:80`]
    writeFileSync(overlay, JSON.stringify({ services }))
    const make = () => {
      const state = { workspace, fingerprint, mode: 'full' }
      state.foundation = new Foundation(state, { project, file: 'compose.yaml', overlays: ['compose.full.yaml', overlay], environment })
      return state
    }
    const initial = make(); foundation = initial.foundation
    foundation.preflight(false); await foundation.start(['postgres', 'redis'])
    foundation.compose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-c', "CREATE TABLE task3_failure_preservation(value text); INSERT INTO task3_failure_preservation VALUES ('stable')"])
    foundation.compose(['run', '--rm', '--no-deps', 'hydra', 'migrate', 'sql', 'up', '--read-from-env', '--yes'])
    await foundation.start(['hydra'])
    const volumes = foundation.verifyVolumes(), foundationIds = foundation.containers().map(container => container.Id).sort()
    const independentProofs = foundation.snapshot().containerProofs
    assert.equal(foundationIds.length, 3)
    for (const id of foundationIds) assert.equal(foundation.inspect(id).State.Running, true)
    const prepared = { volumes }, options = { modeRecordPath, build: async () => {}, check: async () => {}, gatewayDigest: () => digest(readFileSync(gatewayPath, 'utf8')),
      ready: async state => {
        for (const service of ['server', 'web', 'gateway']) {
          const container = state.foundation.containers().find(container => container.Config.Labels['com.docker.compose.service'] === service)
          if (!container?.State.Running && container) console.log(redact(state.foundation.call(['logs', container.Id], true).stderr, secrets))
          assert.equal(container?.State.Running, true, service)
        }
        assert.equal(state.foundation.compose(['exec', '-T', 'gateway', 'nginx', '-t']).status, 0)
        let response
        for (let attempt = 0; attempt < 40; attempt++) {
          try { response = await gatewayResponse(ports.gateway, '/api/health'); if (response.status === 200) break } catch {}
          await delay(100)
        }
        assert.equal(response?.status, 200)
        assert.deepEqual(JSON.parse(response.body), { fixtureApi: true, path: '/api/health' })
        // Call the production helper used by legacy fullReady/readinessDev,
        // with the exact loopback + explicit virtual Host transport.
        await httpReady(`http://127.0.0.1:${ports.gateway}/api/health`, { headers: { Host: 'exwebsite.test' }, timeout: 2000,
          expected: async result => result instanceof Response && (await result.json()).fixtureApi === true })
        const deniedHost = await gatewayResponse(ports.gateway, '/api/health', 'foreign.test')
        assert.equal(deniedHost.status, 421)
        await assert.rejects(httpReady(`http://127.0.0.1:${ports.gateway}/api/health`, { headers: { Host: 'foreign.test' }, timeout: 300 }), /APPLICATION_NOT_READY/)
        for (const [path, status] of [['/api/internal/test', 404], ['/docs/internal/test', 404], ['/docs/', 503], ['/docs/static/test.js', 503]]) {
          const smoke = await gatewayResponse(ports.gateway, path)
          assert.equal(smoke.status, status, path)
          if (status === 404) await assert.rejects(httpReady(`http://127.0.0.1:${ports.gateway}${path}`, {
            headers: { Host: 'exwebsite.test' }, timeout: 300 }), /APPLICATION_NOT_READY/)
        }
      } }
    const owner = state => acquireLock({ mode: 'full', fingerprint: state.fingerprint, directory })
    const stateForRetry = () => {
      const state = make(), prior = existsSync(modeRecordPath) ? JSON.parse(readFileSync(modeRecordPath, 'utf8')) : undefined
      transitionStoppedApplications(state, prior, volumes); state.foundation.preflight(true, volumes)
      return state
    }
    const proveBeforeRelease = (lock, state) => {
      const release = lock.release
      lock.release = () => {
        const record = JSON.parse(readFileSync(modeRecordPath, 'utf8'))
        assert.equal(existsSync(lock.path), true); assert.equal(record.runId, lock.record.runId)
        assert.equal(record.fingerprint, fingerprint); assert.equal(record.state, 'stopped'); assert.ok(record.stoppedAt)
        const owned = new Set([...record.resources.started, ...record.resources.createdStopped].map(item => item.id))
        assert.deepEqual(record.resources.preRunning.map(item => item.id).sort(), foundationIds)
        for (const proof of record.resources.containerProofs) {
          const container = state.foundation.inspect(proof.id)
          assert.equal(owned.has(proof.id) || foundationIds.includes(proof.id), true)
          assert.equal(container.State.Running, !owned.has(proof.id))
          state.foundation.verifyRecordedContainer(container, proof)
        }
        for (const proof of independentProofs) state.foundation.verifyRecordedContainer(state.foundation.inspect(proof.id), proof)
        release()
      }
    }
    // A real independent fixture reserves the web publication. Compose creates
    // server and web, then web fails to bind; no fake Foundation/start adapter.
    blockerId = foundation.call(['run', '-d', '--label', `dev.exwebsite.fixture=${project}`, '-p', `127.0.0.1:${ports.web}:80`, images.node,
      'node', '-e', 'process.on("SIGTERM",()=>process.exit(0));setInterval(()=>{},1000)']).stdout.trim()
    let state = stateForRetry(), lock = owner(state); proveBeforeRelease(lock, state)
    assert.equal(existsSync(modeRecordPath), false)
    await assert.rejects(fullUpRuntime(state, lock, prepared, options), /FOUNDATION_START_FAILED/)
    assert.equal(existsSync(lock.path), false)
    let record = JSON.parse(readFileSync(modeRecordPath, 'utf8'))
    assert.deepEqual(record.managedApplications.map(item => item.service).sort(), ['server', 'web'])
    assert.deepEqual(record.resources.createdStopped.map(item => item.service), ['web'])
    assert.equal(record.resources.started.some(item => item.service === 'web'), false)
    const failedWebId = record.resources.createdStopped[0].id
    assert.equal(state.foundation.containers().filter(container => container.State.Running).length, 3)
    assert.equal(foundation.inspect(blockerId).Config.Labels['dev.exwebsite.fixture'], project)
    foundation.call(['rm', '-f', blockerId]); blockerId = undefined
    // Same prepared target and configuration now retries successfully.
    state = stateForRetry(); lock = owner(state)
    assert.equal(state.foundation.inspect(failedWebId), null)
    await fullUpRuntime(state, lock, prepared, options)
    const recoveredWeb = state.foundation.containers().find(item => item.Config.Labels['com.docker.compose.service'] === 'web')
    assert.notEqual(recoveredWeb.Id, failedWebId)
    assert.ok(Object.values(recoveredWeb.NetworkSettings.Networks).some(network => network.Aliases?.includes('web')))
    assert.equal(lock.record.persistent, true)
    await fullDownRuntime(state, lock.record, volumes, { modeRecordPath }); lock.release()
    record = JSON.parse(readFileSync(modeRecordPath, 'utf8'))
    assert.equal(record.state, 'stopped')
    await fullDownRuntime(state, record, volumes, { modeRecordPath })
    // Actual all-application readiness failure from an old stopped full record.
    state = stateForRetry(); lock = owner(state); proveBeforeRelease(lock, state)
    await assert.rejects(fullUpRuntime(state, lock, prepared, { ...options, ready: async current => { await options.ready(current); throw new Error('fixture readiness failure') } }), /fixture readiness failure/)
    assert.equal(existsSync(lock.path), false)
    record = JSON.parse(readFileSync(modeRecordPath, 'utf8'))
    assert.deepEqual(record.managedApplications.map(item => item.service).sort(), ['gateway', 'server', 'web'])
    // Enter from an actual stopped dev gateway too, using the same strict
    // production profile transition before the new full-up lifecycle.
    const devOverlay = join(workspace, 'dev.json')
    writeFileSync(devOverlay, JSON.stringify({ services: legacyRuntimeServices('dev', { gatewayPath, initPath, postgresPort: ports.postgres, redisPort: ports.redis }) }))
    const dev = { workspace, fingerprint: digest({ fingerprint, mode: 'dev' }), mode: 'dev' }
    dev.foundation = new Foundation(dev, { project, file: 'compose.yaml', overlays: ['compose.dev.yaml', devOverlay],
      environment: { ...environment, WEBSITE_SERVER_UPSTREAM: 'host.docker.internal:18080', WEBSITE_WEB_UPSTREAM: 'host.docker.internal:18081',
        OUTLINE_BACKEND_UPSTREAM: 'host.docker.internal:13102', OUTLINE_STATIC_UPSTREAM: 'host.docker.internal:13101' } })
    assert.equal(transitionStoppedApplications(dev, record, volumes).length, 3)
    dev.foundation.preflight(true, volumes); await dev.foundation.start(['gateway']); await dev.foundation.stopStarted()
    writeFileSync(modeRecordPath, JSON.stringify({ version: 1, runId: randomUUID(), mode: 'dev', fingerprint: dev.fingerprint,
      state: 'stopped', stoppedAt: new Date().toISOString(), resources: dev.foundation.snapshot() }))
    state = stateForRetry(); lock = owner(state); proveBeforeRelease(lock, state)
    await assert.rejects(fullUpRuntime(state, lock, prepared, { ...options, ready: async current => { await options.ready(current); throw new Error('fixture readiness failure') } }), /fixture readiness failure/)
    assert.equal(existsSync(lock.path), false)
    record = JSON.parse(readFileSync(modeRecordPath, 'utf8'))
    assert.equal(foundationIds.every(id => foundation.inspect(id)?.State.Running), true)
    assert.equal(foundation.compose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-At', '-c', 'SELECT value FROM task3_failure_preservation']).stdout.trim(), 'stable')
    assert.deepEqual(foundation.verifyVolumes(), volumes)
    // An exact newly created application may exit before Foundation's running
    // sample. Nonzero StartedAt remains evidence it actually ran; retain its
    // stopped ownership and do not force-retire it as a never-started artifact.
    const originalOverlay = readFileSync(overlay, 'utf8'), exitedServices = JSON.parse(originalOverlay)
    exitedServices.services.server.command = ['-e', 'console.log("fixture child exit 7");process.exit(7)']
    writeFileSync(overlay, JSON.stringify(exitedServices))
    state = stateForRetry(); lock = owner(state); proveBeforeRelease(lock, state)
    let exitedServerId
    await assert.rejects(fullUpRuntime(state, lock, prepared, { ...options, ready: async current => {
      const server = current.foundation.containers().find(item => item.Config.Labels['com.docker.compose.service'] === 'server')
      exitedServerId = server.Id
      assert.equal(server.State.Running, false); assert.equal(server.State.ExitCode, 7)
      assert.ok(Date.parse(server.State.StartedAt) > 0)
      console.log('FIXTURE_APPLICATION_CHILD_EXIT code=7')
      throw new Error('fixture child exited 7')
    } }), /fixture child exited 7/)
    record = JSON.parse(readFileSync(modeRecordPath, 'utf8'))
    assert.equal(record.resources.started.some(item => item.id === exitedServerId), true)
    assert.equal(record.resources.createdStopped.some(item => item.id === exitedServerId), false)
    assert.deepEqual(transitionStoppedApplications(make(), record, volumes), [])
    await fullDownRuntime(make(), record, volumes, { modeRecordPath })
    assert.ok(foundation.inspect(exitedServerId))
    writeFileSync(overlay, originalOverlay)
    // A same-configuration application created by an external fixture action
    // is never adopted merely because it appeared during this up operation.
    state = stateForRetry(); retainedLock = owner(state)
    let unknownOutline, refusedCleanupStops = 0
    const originalCall = state.foundation.call.bind(state.foundation)
    state.foundation.call = (args, allowFailure) => { if (args[0] === 'stop') refusedCleanupStops++; return originalCall(args, allowFailure) }
    await assert.rejects(fullUpRuntime(state, retainedLock, prepared, { ...options, build: async () => {
      state.foundation.compose(['create', '--no-build', 'outline'])
      unknownOutline = state.foundation.containers().find(container => container.Config.Labels['com.docker.compose.service'] === 'outline')
    } }), /OWNER_UNKNOWN/)
    assert.equal(existsSync(retainedLock.path), true)
    assert.equal(state.foundation.inspect(unknownOutline.Id).State.Running, false)
    assert.equal(retainedLock.record.resources.started.some(item => item.id === unknownOutline.Id), false)
    assert.equal(refusedCleanupStops, 0)
    const retainedResources = structuredClone(retainedLock.record.resources)
    const retainedOwned = retainedResources.started.filter(item => ['server', 'web', 'gateway'].includes(item.service))
    assert.ok(retainedOwned.length > 0)
    for (const item of retainedOwned) {
      const container = state.foundation.inspect(item.id)
      assert.equal(container.State.Running, true)
      state.foundation.verifyRecordedContainer(container, retainedResources.containerProofs.find(proof => proof.id === item.id))
    }
    // Explicitly remove only the known test-created foreign fixture. The same
    // still-held owner must certify its current journal through production down
    // before releasing it; the older mode file cannot authorize its new IDs.
    state.foundation.call(['rm', unknownOutline.Id])
    assert.deepEqual(retainedLock.record.resources, retainedResources)
    await fullDownRuntime(state, { ...retainedLock.record,
      managedApplications: retainedLock.record.resources.started.filter(item => ['server', 'web', 'outline', 'gateway'].includes(item.service)) }, volumes, { modeRecordPath })
    for (const item of retainedOwned) assert.equal(state.foundation.inspect(item.id).State.Running, false)
    for (const id of foundationIds) assert.equal(state.foundation.inspect(id).State.Running, true)
    assert.deepEqual(state.foundation.verifyVolumes(), volumes)
    assert.equal(state.foundation.compose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-At', '-c', 'SELECT value FROM task3_failure_preservation']).stdout.trim(), 'stable')
    record = JSON.parse(readFileSync(modeRecordPath, 'utf8'))
    for (const proof of record.resources.containerProofs) state.foundation.verifyRecordedContainer(state.foundation.inspect(proof.id), proof)
    retainedLock.release(); retainedLock = undefined
    // A real external HostConfig change makes cleanup fail. Ownership survives,
    // and the old stopped journal is not overwritten with a fake success.
    const stoppedBeforeFailure = readFileSync(modeRecordPath, 'utf8')
    state = stateForRetry(); retainedLock = owner(state)
    await assert.rejects(fullUpRuntime(state, retainedLock, prepared, { ...options, ready: async current => {
      await options.ready(current)
      const server = current.foundation.containers().find(container => container.Config.Labels['com.docker.compose.service'] === 'server')
      current.foundation.call(['update', '--restart', 'always', server.Id])
      throw new Error('fixture readiness failure')
    } }), /STOPPED_CONTAINER_OWNERSHIP_CONFLICT/)
    assert.equal(existsSync(retainedLock.path), true)
    const failed = JSON.parse(readFileSync(retainedLock.path, 'utf8'))
    assert.equal(failed.state, 'cleanup-failed'); assert.equal(failed.stoppedAt, undefined)
    assert.equal(readFileSync(modeRecordPath, 'utf8'), stoppedBeforeFailure)
    const currentIds = foundation.containers().map(container => container.Id).sort()
    assert.throws(() => transitionStoppedApplications(make(), record, volumes), /RESTARTED|OWNERSHIP_CONFLICT/)
    assert.deepEqual(foundation.containers().map(container => container.Id).sort(), currentIds)
    console.log(JSON.stringify({ project, productionFullUpLifecycle: true, initiallyNoModeRecord: true, realPartialComposeStartFailure: true,
      stoppedProofSavedBeforeRelease: true, retryAndDown: true, awaitingNginxConfigApiInternalDocsSmoke: true, productionHttpReadyNginxHostAndInternalProof: true,
      earlyExit7ExactStoppedOwnership: true, oldStoppedFullAndDevReadinessFailure: true, unknownSameConfigNotAdopted: true, proofFailureRetainedLock: true,
      originalPreRunningFoundationPreserved: foundationIds, marker: 'stable', volumes, beforeContainers }))
  } finally {
    if (blockerId && foundation?.inspect(blockerId)?.Config.Labels['dev.exwebsite.fixture'] === project) foundation.call(['rm', '-f', blockerId], true)
    foundation?.compose(['down', '--volumes', '--remove-orphans'], true)
    assert.equal(foundation?.containers().length ?? 0, 0)
    retainedLock?.release()
    const afterContainers = foundation?.call(['ps', '-a', '--format', '{{.ID}} {{.Names}}']).stdout.trim().split(/\r?\n/).filter(Boolean) ?? []
    assert.equal(beforeContainers.every(item => afterContainers.includes(item)), true)
    console.log(JSON.stringify({ project, cleaned: true, afterContainers }))
    rmSync(workspace, { recursive: true, force: true })
  }
})
