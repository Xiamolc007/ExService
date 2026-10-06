import { createServer } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'
import { existsSync, appendFileSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { root, localRoot } from './configure.mjs'
import { atomicJson, digest, loadLocal, LocalError, localDirectory, localEnvironments, readJson, toolchain } from './local-config.mjs'
import { acquireLock, identityAlive, processIdentity, runOwned, signalScope, spawnOwned, stopOwned } from './ownership.mjs'
import { Foundation, docker } from './foundation.mjs'
import { ensureHydraClient, verifyHydraClient } from './hydra-client.mjs'

export function preparedState(state, requireBootstrap = false) {
  const record = readJson(join(state.directory, 'prepared.json'), 'LOCAL_NOT_INITIALIZED')
  if (record.version !== 1 || record.fingerprint !== state.fingerprint || !Array.isArray(record.volumes) || !record.volumes.length || !record.stages?.initialized ||
      (requireBootstrap && (!record.stages.bootstrap || !validUuid(record.adminUserId))))
    throw new LocalError('LOCAL_NOT_PREPARED', requireBootstrap
      ? 'pnpm infra bootstrap --admin-user-id <Website UUID>' : 'pnpm infra init')
  return record
}
export function savePrepared(state, extra) {
  const path = join(state.directory, 'prepared.json')
  const existing = existsSync(path) ? readJson(path, 'LOCAL_PREPARED_INVALID') : undefined
  if (existing && existing.fingerprint !== state.fingerprint) throw new LocalError('LOCAL_PREPARED_TARGET_CONFLICT')
  atomicJson(path, { version: 1, fingerprint: state.fingerprint, websiteTarget: state.config.websiteTarget,
    ...existing, ...extra, verifiedAt: new Date().toISOString() })
}
export const validUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
export async function assertPortFree(port) {
  const server = createServer()
  try {
    await new Promise((resolve, reject) => {
      server.once('error', () => reject(new LocalError('APPLICATION_PORT_OCCUPIED', 'stop the port owner in its own terminal')))
      server.listen(port, '127.0.0.1', resolve)
    })
  } finally { if (server.listening) await new Promise(resolve => server.close(resolve)) }
}
function explicitHostResponse(url, headers, signal) {
  const target = new URL(url)
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) return Promise.reject(new Error('Invalid readiness URL'))
  return new Promise((resolve, reject) => {
    const request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
      headers: Object.fromEntries(new Headers(headers)), signal,
    }, incoming => {
      incoming.once('error', reject)
      try {
        const responseHeaders = new Headers()
        for (const [name, values] of Object.entries(incoming.headers)) for (const value of Array.isArray(values) ? values : [values]) {
          if (value !== undefined) responseHeaders.append(name, value)
        }
        const noBody = [204, 205, 304].includes(incoming.statusCode)
        const response = new Response(noBody ? null : Readable.toWeb(incoming), {
          status: incoming.statusCode, statusText: incoming.statusMessage, headers: responseHeaders,
        })
        Object.defineProperty(response, 'url', { value: target.href })
        if (noBody) incoming.resume()
        resolve(response)
      } catch (error) { incoming.destroy(); reject(error) }
    })
    request.once('error', reject); request.end()
  })
}
export async function httpReady(url, { children = [], expected, timeout = 120000, headers } = {}) {
  const deadline = Date.now() + timeout
  const childExited = () => children.some(owned => owned.child.exitCode !== null || owned.child.signalCode !== null)
  while (Date.now() < deadline) {
    if (childExited()) throw new LocalError('APP_EXITED_DURING_START')
    const attemptDeadline = Math.min(deadline, Date.now() + 1000), controller = new AbortController()
    const requestDeadline = setTimeout(() => controller.abort(), Math.max(0, attemptDeadline - Date.now()))
    const childPoll = setInterval(() => { if (childExited()) controller.abort() }, 50)
    let response
    try {
      const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }))
      const ready = await Promise.race([aborted, (async () => {
        response = new Headers(headers).has('host')
          ? await explicitHostResponse(url, headers, controller.signal)
          : await fetch(url, { headers, redirect: 'manual', signal: controller.signal })
        return response.ok && (!expected || await expected(response))
      })()])
      if (childExited()) throw new LocalError('APP_EXITED_DURING_START')
      if (ready && Date.now() < attemptDeadline) return
    } catch { if (childExited()) throw new LocalError('APP_EXITED_DURING_START') }
    finally {
      clearTimeout(requestDeadline); clearInterval(childPoll); controller.abort()
      response?.body?.cancel().catch(() => {})
    }
    await delay(Math.min(250, Math.max(0, deadline - Date.now())))
  }
  if (childExited()) throw new LocalError('APP_EXITED_DURING_START')
  throw new LocalError('APPLICATION_NOT_READY', 'inspect this run\'s redacted logs and explicit prepared stages')
}
export function specifications(state, tools = toolchain()) {
  const env = applicationEnvironments(state, tools)
  return [
    { name: 'server', cwd: state.workspace, command: tools.node,
      args: [tools.corepack, 'pnpm', '--filter', '@workspace/server', 'dev'], environment: env.server },
    { name: 'web', cwd: state.workspace, command: tools.node,
      args: [tools.corepack, 'pnpm', '--filter', '@workspace/web', 'dev'], environment: env.web },
    { name: 'outline', cwd: join(state.workspace, 'apps/outline'), command: tools.node,
      args: [tools.corepack, 'yarn', 'dev:watch:integration'], environment: env.outline },
  ]
}
export function cliSpecification(state, tools, service, args) {
  const env = applicationEnvironments(state, tools)
  return { name: service, command: tools.node, cwd: service === 'outline' ? join(state.workspace, 'apps/outline') : state.workspace,
    args: [tools.corepack, service === 'outline' ? 'yarn' : 'pnpm', ...(service === 'outline' ? [] : ['--filter', '@workspace/server']), ...args],
    environment: env[service] }
}
function applicationEnvironments(state, tools) {
  const environments = localEnvironments(state)
  if (!state.environments) return environments
  return Object.fromEntries(Object.entries(environments).map(([service, environment]) => {
    const path = Object.entries(environment).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? ''
    return [service, { ...Object.fromEntries(Object.entries(environment).filter(([key]) => key.toUpperCase() !== 'PATH')),
      PATH: `${dirname(tools.node)}${delimiter}${path}` }]
  }))
}
export function hydraOptions(state) {
  const c = state.config
  return { mode: 'local', adminUrl: `http://127.0.0.1:${c.ports.hydraAdmin}/`, publicUrl: c.issuer,
    publicOrigin: c.publicOrigin, callback: c.callback, clientId: c.clientId, clientSecret: state.secrets.OUTLINE_OIDC_CLIENT_SECRET }
}
export async function verifyFoundationSchemas(state, { bootstrap = false } = {}) {
  const { default: pg } = await import('pg')
  for (const name of ['outline', 'hydra']) {
    const password = state.secrets[`${name.toUpperCase()}_PASSWORD`]
    const client = new pg.Client({ host: '127.0.0.1', port: state.config.ports.postgres, database: name, user: name, password, connectionTimeoutMillis: 3000 })
    try {
      await client.connect(); await client.query('BEGIN READ ONLY')
      const identity = await client.query('SELECT current_database() AS name, current_user AS owner')
      if (identity.rows[0]?.name !== name || identity.rows[0]?.owner !== name) throw new Error()
      const unsafe = await client.query("SELECT d.datname FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE (d.datname IN ('outline','hydra') AND d.datname<>r.rolname) OR d.datname='exre'")
      const roles = await client.query("SELECT rolname FROM pg_roles WHERE rolname IN ('outline','hydra') AND (NOT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)")
      if (unsafe.rows.length || roles.rows.length) throw new Error()
      if (name === 'outline') {
        const migrations = new Set((await client.query('SELECT name FROM "SequelizeMeta"')).rows.map(row => row.name))
        if (readdirSync(join(state.workspace, 'apps/outline/server/migrations')).filter(file => file.endsWith('.js')).some(file => !migrations.has(file))) throw new Error()
        const columns = new Set((await client.query('SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=current_schema()')).rows.map(row => `${row.table_name}.${row.column_name}`))
        for (const column of ['teams.id', 'users.id', 'website_integrations.issuer', 'website_integrations.initialAdminSubject',
          'external_identities.issuer', 'external_sessions.clientId', 'external_revocation_events.eventId']) if (!columns.has(column)) throw new Error()
        const extensions = new Set((await client.query('SELECT extname FROM pg_extension')).rows.map(row => row.extname))
        if (!extensions.has('pg_trgm')) throw new Error()
        const markers = (await client.query('SELECT issuer,"initialAdminSubject" FROM website_integrations')).rows
        if (markers.length > 1 || (markers.length && markers[0].issuer !== state.config.issuer) || (bootstrap && !markers.length)) throw new Error()
      } else {
        const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND (tablename LIKE 'hydra_%' OR tablename='schema_migration')")).rows
        if (!tables.some(row => row.tablename === 'hydra_client') || !tables.some(row => /migration/.test(row.tablename))) throw new Error()
      }
      await client.query('ROLLBACK')
    } catch { throw new LocalError('LOCAL_SCHEMA_NOT_READY', 'pnpm infra migrate; then explicit bootstrap if needed') }
    finally { await client.end().catch(() => {}) }
  }
}
export async function foundationReady(state, foundation) {
  if (foundation.compose(['exec', '-T', 'redis', 'redis-cli', 'ping']).stdout.trim() !== 'PONG') throw new LocalError('LOCAL_REDIS_NOT_READY')
  await httpReady(`http://127.0.0.1:${state.config.ports.hydraAdmin}/health/ready`, { timeout: 20000 })
  await httpReady(new URL('/.well-known/openid-configuration', state.config.issuer), {
    timeout: 20000, expected: async response => (await response.json()).issuer === state.config.issuer,
  })
}
export function refuseLegacyOwnership(prior) {
  const modeFile = join(localRoot, 'mode.json')
  if (existsSync(modeFile)) {
    const legacy = readJson(modeFile, 'LEGACY_MODE_INVALID')
    if (!legacy.stoppedAt) {
      if (legacy.identity && !identityAlive(legacy.identity)) { /* verified exited supervisor; containers checked below */ }
      else throw new LocalError('LEGACY_MODE_ACTIVE', 'node scripts/docs-integration/command.mjs down in the original verified mode')
    }
  }
  const result = docker(['ps', '--filter', 'label=com.docker.compose.project=exwebsite-docs-integration', '--format', '{{.Label "com.docker.compose.service"}}'])
  const applications = result.stdout.trim().split(/\r?\n/).filter(name => ['server', 'web', 'outline', 'gateway'].includes(name))
  if (applications.length || prior?.persistent) throw new LocalError('LEGACY_APPLICATION_CONTAINERS_ACTIVE', 'stop the original verified legacy run first')
}
function validJournal(state, value) {
  if (value?.state === 'preflight' && !value.resources) value = { ...value,
    resources: { started: [], preRunning: [], createdStopped: [], containerProofs: [] },
    preparation: { version: 1, status: 'partial', stage: 'preflight', volumes: [] } }
  if (value?.version !== 1 || value.mode !== 'local' || value.fingerprint !== state.fingerprint || !validUuid(value.runId) ||
      !value.identity?.pid || !value.identity.creation || !value.identity.executable || !value.identity.commandDigest ||
      !value.resources || !Array.isArray(value.resources.started) || !Array.isArray(value.resources.preRunning) || !Array.isArray(value.resources.containerProofs))
    throw new LocalError('FOUNDATION_PROVENANCE_INVALID', 'inspect the original local ownership journal; no resources were stopped')
  return value
}
/** Runtime is authoritative, with preparation-owned IDs retained separately from independent pre-running IDs. */
export function localRecovery(state, prior) {
  const read = name => existsSync(join(state.directory, name)) ? validJournal(state, readJson(join(state.directory, name))) : undefined
  const preparation = read('foundation.json'), runtime = read('run.json'), retired = read('retired-run.json'), dependencies = read('dependencies.json')
  const latest = prior ? validJournal(state, prior.recovery ?? prior) : dependencies ?? runtime ?? retired ?? preparation
  if (!latest) throw new LocalError('FOUNDATION_JOURNAL_MISSING')
  const started = new Map(), preRunning = new Map(), proofs = new Map(), createdStopped = new Map()
  // Later records must carry the same original proof for a shared exact ID.
  for (const journal of [preparation, retired, runtime, dependencies, latest].filter(Boolean)) {
    for (const item of journal.resources.containerProofs) {
      if (proofs.has(item.id) && digest(proofs.get(item.id)) !== digest(item)) throw new LocalError('FOUNDATION_PROOF_HISTORY_CONFLICT')
      proofs.set(item.id, item)
    }
    for (const item of journal.resources.preRunning) preRunning.set(item.id, item)
    for (const item of journal.resources.started) started.set(item.id, item)
    if (journal.resources.createdStopped && !Array.isArray(journal.resources.createdStopped)) throw new LocalError('FOUNDATION_PROVENANCE_INVALID')
    for (const item of journal.resources.createdStopped ?? []) createdStopped.set(item.id, item)
  }
  for (const id of started.keys()) preRunning.delete(id)
  for (const id of started.keys()) createdStopped.delete(id)
  return { ...latest, preparation: latest.preparation ?? preparation?.preparation,
    resources: { started: [...started.values()], preRunning: [...preRunning.values()], createdStopped: [...createdStopped.values()], containerProofs: [...proofs.values()] } }
}
function restoreLocal(state, foundation, registry) {
  if (existsSync(join(state.directory, 'prepared.json'))) return foundation.restore(registry.resources, preparedState(state).volumes)
  const partial = registry.preparation
  if (partial?.version !== 1 || partial.status !== 'partial' || !Array.isArray(partial.volumes)) throw new LocalError('LOCAL_PARTIAL_PROVENANCE_INVALID')
  return foundation.restore(registry.resources, partial.volumes, { partial: true })
}
export function preparationJournal(state, lock, resources, persist = atomicJson, preparation) {
  const file = join(state.directory, 'foundation.json')
  const previous = existsSync(file) ? validJournal(state, readJson(file)) : undefined
  const started = new Map([...(previous?.resources.started ?? []), ...resources.started].map(item => [item.id, item]))
  const proofs = new Map([...(previous?.resources.containerProofs ?? []), ...resources.containerProofs].map(item => [item.id, item]))
  for (const proof of previous?.resources.containerProofs ?? []) if (resources.containerProofs.some(item => item.id === proof.id && digest(item) !== digest(proof)))
    throw new LocalError('FOUNDATION_PROOF_HISTORY_CONFLICT')
  const merged = { ...resources, started: [...started.values()], preRunning: resources.preRunning.filter(item => !started.has(item.id)), containerProofs: [...proofs.values()] }
  const value = { version: 1, mode: 'local', fingerprint: state.fingerprint, runId: lock.record.runId, identity: lock.record.identity,
    state: 'preparing', resources: merged, ...(preparation || previous?.preparation ? { preparation: preparation ?? previous.preparation } : {}) }
  lock.update({ resources: merged, ...(value.preparation ? { preparation: value.preparation } : {}) }); persist(file, value)
  return value
}
export function localOwnershipCheck(state, foundation, { externalCheck = refuseLegacyOwnership, legacyFoundation } = {}) {
  return prior => {
    if (prior?.temporary && identityAlive(prior.temporary)) throw new LocalError('MODE_CHILDREN_STILL_ACTIVE', 'stop the original preparation child in its own terminal')
    externalCheck(prior)
    if (prior && prior.mode !== 'local') {
      if (prior.version !== 1 || !['dev', 'full'].includes(prior.mode) || !validUuid(prior.runId) || !prior.fingerprint ||
          !prior.identity?.pid || !prior.identity.creation || !prior.identity.executable || !prior.identity.commandDigest ||
          prior.cleanupRequired || prior.state === 'cleanup-failed' || prior.persistent)
        throw new LocalError('FOREIGN_JOURNAL_PROVENANCE_INVALID')
      const resources = prior.resources ?? (prior.state === 'preflight' ? { started: [], preRunning: [], containerProofs: [] } : undefined)
      if (!resources || !Array.isArray(resources.started) || !Array.isArray(resources.preRunning) || !Array.isArray(resources.containerProofs) ||
          (resources.createdStopped && (!Array.isArray(resources.createdStopped) || resources.createdStopped.length)))
        throw new LocalError('FOREIGN_JOURNAL_PROVENANCE_INVALID')
      const legacy = legacyFoundation ?? new Foundation(state, { project: 'exwebsite-docs-integration' })
      const owned = new Map(resources.started.map(item => [item.id, item])), known = new Map([...resources.started, ...resources.preRunning].map(item => [item.id, item]))
      const proofs = new Map(resources.containerProofs.map(item => [item.id, item]))
      for (const item of known.values()) {
        if (!item.id || !item.service || !proofs.has(item.id) || proofs.get(item.id).service !== item.service) throw new LocalError('FOREIGN_JOURNAL_PROVENANCE_INVALID')
        const actual = legacy.inspect(item.id)
        if (actual) {
          legacy.verifyRecordedContainer(actual, proofs.get(item.id))
          if (owned.has(item.id) && actual.State.Running) throw new LocalError('FOREIGN_CLEANUP_REQUIRED')
        }
      }
      for (const actual of legacy.containers()) {
        if (!known.has(actual.Id)) throw new LocalError('FOREIGN_OWNER_UNKNOWN')
        legacy.verifyRecordedContainer(actual, proofs.get(actual.Id))
      }
      // Preserve foreign provenance independently; it never grants local stop ownership.
      atomicJson(join(state.directory, 'retired-legacy-run.json'), prior)
      prior = undefined
    }
    const exists = ['foundation.json', 'run.json', 'retired-run.json', 'dependencies.json'].some(name => existsSync(join(state.directory, name)))
    if (!exists && !prior) {
      foundation.verifyVolumeInventory()
      if (foundation.containers().length || foundation.verifyVolumes(false).length) throw new LocalError('FOUNDATION_OWNER_UNKNOWN')
      return
    }
    const registry = localRecovery(state, prior)
    restoreLocal(state, foundation, registry)
    // Preserve exited-owner evidence before acquireLock replaces the stale lock.
    if (prior) atomicJson(join(state.directory, 'retired-run.json'), registry)
    foundation.started.clear(); foundation.preRunning.clear()
  }
}
export async function initializeLocal(state, { migrateOnly = false, foundation = new Foundation(state), lock, directory = localRoot,
  inspect = processIdentity, externalCheck = refuseLegacyOwnership, persist = atomicJson, execute = runOwned,
  verifySchemas = verifyFoundationSchemas } = {}) {
  const tools = toolchain({ workspace: state.workspace, inherited: state.values ?? process.env })
  const occupancy = existsSync(join(directory, 'mode-lock.json')) ? readJson(join(directory, 'mode-lock.json')) : undefined
  const needsRecovery = !occupancy || occupancy.mode === 'local'
  const recoverPreparation = prior => {
    const empty = { resources: { started: [], preRunning: [], createdStopped: [], containerProofs: [] },
      preparation: { version: 1, status: 'partial', stage: 'preflight', volumes: [] } }
    if (!prior && !existsSync(join(state.directory, 'foundation.json'))) return empty
    if (!prior && existsSync(join(state.directory, 'prepared.json'))) {
      const recovery = localRecovery(state)
      return { recovery, resources: recovery.resources, preparation: recovery.preparation }
    }
    const recovery = localRecovery(state, prior)
    if (prior?.state === 'stopped' && !prior.cleanupRequired && existsSync(join(state.directory, 'prepared.json')))
      return { recovery, resources: recovery.resources, preparation: recovery.preparation }
    if (recovery.preparation?.status !== 'partial' || existsSync(join(state.directory, 'run.json')) && readJson(join(state.directory, 'run.json')).state !== 'stopped')
      throw new LocalError('LOCAL_PREPARATION_RECOVERY_REQUIRES_DOWN')
    return { recovery, resources: recovery.resources, preparation: recovery.preparation }
  }
  lock ??= acquireLock({ mode: 'local', fingerprint: state.fingerprint, directory, inspect,
    externalCheck: localOwnershipCheck(state, foundation, { externalCheck }), recoverCleanup: needsRecovery ? recoverPreparation : undefined })
  const scope = signalScope()
  let stage = 'preflight', completed = false
  const journal = resources => {
    const value = preparationJournal(state, lock, resources, persist,
      { version: 1, status: 'partial', stage, volumes: foundation.verifyVolumes(false) })
    lock.update({ recovery: value })
    return value
  }
  try {
    if (lock.record.resources) restoreLocal(state, foundation, validJournal(state, lock.record.recovery ?? lock.record))
    const originalVolumes = existsSync(join(state.directory, 'prepared.json')) ? preparedState(state).volumes :
      (lock.record.preparation ?? lock.record.recovery?.preparation)?.volumes ?? []
    foundation.preflight(migrateOnly, originalVolumes)
    if (migrateOnly) preparedState(state)
    lock.update({ state: 'preparing', cleanupRequired: true })
    if (foundation.createdStopped.size) {
      const recovery = localRecovery(state, lock.record.recovery ?? lock.record)
      foundation.retireCreatedStopped(recovery.resources, existsSync(join(state.directory, 'prepared.json')) ? preparedState(state).volumes : recovery.preparation.volumes,
        { partial: !existsSync(join(state.directory, 'prepared.json')) })
    }
    journal(foundation.snapshot())
    stage = 'foundation'
    await foundation.start(['postgres', 'redis'], { onChange: journal })
    scope.check()
    stage = 'databases'; journal(foundation.snapshot())
    foundation.compose(['exec', '-T', 'postgres', 'sh', '/docker-entrypoint-initdb.d/10-local-databases.sh'])
    stage = 'hydra-migration'; journal(foundation.snapshot())
    foundation.compose(['run', '--rm', '--no-deps', 'hydra', 'migrate', 'sql', 'up', '--read-from-env', '--yes'])
    const log = (name, line) => console.log(`[${name}] ${line}`)
    stage = 'outline-migration'; journal(foundation.snapshot())
    await execute(cliSpecification(state, tools, 'outline', ['db:migrate', '--env', 'production-ssl-disabled']), { onLog: log, signal: scope.signal })
    stage = 'outline-build'; journal(foundation.snapshot())
    await execute(cliSpecification(state, tools, 'outline', ['build:server']), { onLog: log, signal: scope.signal })
    scope.check()
    stage = 'schema'; journal(foundation.snapshot())
    await verifySchemas(state)
    savePrepared(state, { volumes: foundation.verifyVolumes(), stages: { initialized: true, ...(existsSync(join(state.directory, 'prepared.json')) ? preparedState(state).stages : {}) } })
    preparationJournal(state, lock, foundation.snapshot(), persist, { version: 1, status: 'initialized', stage: 'complete', volumes: foundation.verifyVolumes() })
    lock.update({ cleanupRequired: false }); completed = true
    console.log('LOCAL_INITIALIZED; Website migration remains explicit: pnpm db:migrate')
  } catch (error) {
    try { lock.update({ state: 'cleanup-failed', cleanupRequired: true }) } catch {}
    throw error
  } finally { scope.close(); if (completed) lock.release() }
}
export async function bootstrapLocal(state, adminUserId, { lock, foundation, preserveDependencies = false, onLog = (name, line) => console.log(`[${name}] ${line}`) } = {}) {
  if (!validUuid(adminUserId)) throw new LocalError('BOOTSTRAP_UUID_REQUIRED', 'pnpm infra bootstrap --admin-user-id <Website UUID>')
  const tools = toolchain({ workspace: state.workspace, inherited: state.values ?? process.env }), ownLock = !lock
  foundation ??= new Foundation(state)
  lock ??= acquireLock({ mode: 'local', fingerprint: state.fingerprint, externalCheck: localOwnershipCheck(state, foundation) })
  const scope = signalScope()
  foundation ??= new Foundation(state)
  let temporary
  try {
    const prepared = preparedState(state); foundation.preflight(true, prepared.volumes); lock.update({ state: 'preparing' })
    await assertPortFree(state.config.ports.api)
    await foundation.start(['postgres', 'redis', 'hydra'], { onChange: resources => preparationJournal(state, lock, resources) })
    scope.check()
    await verifyFoundationSchemas(state); await foundationReady(state, foundation)
    await runOwned(cliSpecification(state, tools, 'server', ['integration:check', '--admin-user-id', adminUserId]), { onLog, signal: scope.signal,
      code: 'WEBSITE_NOT_READY', next: 'pnpm db:migrate; then explicit bootstrap with an active Website UUID' })
    const environment = localEnvironments(state).server
    temporary = await spawnOwned({ name: 'temporary-server', command: tools.node, cwd: join(state.workspace, 'apps/server'),
      args: [...(state.environments ? [] : ['--env-file-if-exists=.env.local']), '--import', 'tsx', 'src/server.ts'], environment }, { onLog, signal: scope.signal })
    lock.update({ temporary: temporary.identity })
    await httpReady(`http://127.0.0.1:${state.config.ports.api}/api/health`, { children: [temporary], timeout: 30000 })
    const response = await fetch(`http://127.0.0.1:${state.config.ports.api}/api/internal/identity/user/inspect`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bootstrap-Key': state.secrets.IDENTITY_BOOTSTRAP_KEY },
      body: JSON.stringify({ userId: adminUserId }), signal: AbortSignal.timeout(2000),
    })
    if (!response.ok || (await response.json()).id !== adminUserId) throw new LocalError('BOOTSTRAP_ADMIN_NOT_ACTIVE')
    await ensureHydraClient(hydraOptions(state))
    const bootstrap = cliSpecification(state, tools, 'outline', ['integration:bootstrap', '--admin-user-id', adminUserId])
    await runOwned(bootstrap, { onLog, signal: scope.signal, code: 'OUTLINE_BOOTSTRAP_FAILED' })
    await runOwned(cliSpecification(state, tools, 'outline', ['integration:check', '--admin-user-id', adminUserId]), { onLog, signal: scope.signal, code: 'OUTLINE_NOT_READY' })
    scope.check()
    await verifyHydraClient(hydraOptions(state))
    savePrepared(state, { adminUserId, stages: { initialized: true, bootstrap: true } })
    console.log('LOCAL_BOOTSTRAP_READY')
  } finally {
    scope.close()
    if (temporary) await stopOwned([temporary])
    lock.update({ temporary: null })
    if (ownLock) { if (!preserveDependencies) await foundation.stopStarted(); lock.release() }
  }
}

/** One supervisor owns each generation; preparation always pauses its complete application set. */
export async function supervise({ mode, fingerprint, directory, specifications: specs, lock, foundation, readiness,
  prepare, awaitingBootstrap = false, onLog = (name, line) => console.log(`[${name}] ${line}`), banner,
  spawnChild = spawnOwned, stopChildren = stopOwned, pollInterval = 250, controlDirectory = localRoot, onPause }) {
  let children = [], stopping = false, generation = 0, state = 'starting', failure
  const runPath = join(directory, 'run.json'), requestPath = join(controlDirectory, 'control-request.json')
  const persist = () => {
    const value = { version: 1, mode, runId: lock.record.runId, fingerprint, identity: lock.record.identity, state,
      children: children.map(child => ({ name: child.specification.name, identity: child.identity })),
      resources: foundation?.snapshot() ?? { started: [], preRunning: [], createdStopped: [], containerProofs: [] } }
    atomicJson(runPath, value); lock.update(value)
  }
  const stopSignal = () => { stopping = true }
  process.on('SIGINT', stopSignal); process.on('SIGTERM', stopSignal)
  const launch = async limited => {
    if (stopping) throw new LocalError('RUN_INTERRUPTED')
    generation++; const current = generation
    state = 'starting'; persist()
    for (const spec of specs.filter(spec => !limited || !['outline', 'exui'].includes(spec.name))) {
      const child = await spawnChild(spec, { onLog }); children.push(child)
      child.exited.then(result => {
        if (current === generation && !stopping) failure = new LocalError(`APP_${spec.name.toUpperCase()}_EXITED_${result.code ?? 'SIGNAL'}`)
      })
      persist()
    }
    await readiness(children, limited)
    if (failure) throw failure
    state = limited ? 'awaiting-bootstrap' : 'ready'; persist()
    console.log(limited ? 'INTEGRATION_AWAITING_BOOTSTRAP; Website available; Outline and full integration NOT_READY' : banner)
  }
  const pause = async () => { generation++; state = 'pausing'; persist(); await stopChildren(children); children = []; await onPause?.(); state = 'preparing'; persist() }
  try {
    await launch(awaitingBootstrap)
    while (!stopping) {
      if (failure) throw failure
      if (existsSync(requestPath)) {
        const request = readJson(requestPath, 'CONTROL_REQUEST_INVALID')
        if (request.runId === lock.record.runId) {
          if (request.action === 'stop') { stopping = true; continue }
          if (request.action === 'bootstrap' && prepare && validUuid(request.adminUserId) &&
              request.mode === mode && request.fingerprint === fingerprint && request.requestId !== lock.record.lastRequestId) {
            lock.update({ lastRequestId: request.requestId })
            await pause()
            let operation
            try {
              operation = acquireLock({ mode, fingerprint, name: 'operation-lock.json', directory: controlDirectory })
              await prepare(request.adminUserId)
              await launch(false)
              atomicJson(join(controlDirectory, 'control-response.json'), { runId: request.runId, requestId: request.requestId, status: 'ready' })
            } catch (error) {
              generation++; await stopChildren(children); children = []; await onPause?.(); state = 'preparation-failed'; failure = undefined; persist()
              atomicJson(join(controlDirectory, 'control-response.json'), { runId: request.runId, requestId: request.requestId,
                status: 'failed', code: error instanceof LocalError ? error.code : 'PREPARATION_FAILED' })
              console.error('PREPARATION_FAILED; owned applications are stopped; retry explicit bootstrap')
            } finally { operation?.release() }
          }
        }
      }
      await delay(pollInterval)
    }
  } finally {
    generation++; stopping = true; state = 'stopping'
    lock.update({ state, cleanupRequired: true }); persist()
    process.off('SIGINT', stopSignal); process.off('SIGTERM', stopSignal)
    try {
      await stopChildren(children)
      await foundation?.stopStarted()
      children = []; state = 'stopped'; persist(); lock.update({ cleanupRequired: false }); lock.release()
    } catch (error) { state = 'cleanup-failed'; try { lock.update({ state, cleanupRequired: true }) } catch {}; persist(); throw error }
  }
}
export async function runLocal({ service, state = loadLocal(), tools = toolchain(), independentDependencies = false } = {}) {
  const prepared = preparedState(state, true), foundation = new Foundation(state)
  const lock = acquireLock({ mode: 'local', fingerprint: state.fingerprint, externalCheck: localOwnershipCheck(state, foundation) })
  const scope = signalScope()
  let handedOff = false
  const logPath = join(state.directory, `run-${lock.record.runId}.log`)
  const onLog = (name, line) => { appendFileSync(logPath, `[${name}] ${line}\n`); console.log(`[${name}] ${line}`) }
  try {
    foundation.preflight(true, prepared.volumes)
    for (const port of [state.config.ports.public, state.config.ports.web, state.config.ports.api, state.config.ports.outline, state.config.ports.outlineVite]) await assertPortFree(port)
    if (independentDependencies) {
      const running = foundation.containers().filter(item => item.State.Running).map(item => item.Config.Labels['com.docker.compose.service'])
      if (!['postgres', 'redis', 'hydra'].every(name => running.includes(name))) throw new LocalError('DEPENDENCIES_NOT_RUNNING', 'pnpm service:start')
    } else await foundation.start(['postgres', 'redis', 'hydra'], { onChange: resources => {
      lock.update({ resources }); atomicJson(join(state.directory, 'run.json'), { ...lock.record, state: 'preflight', resources })
    } })
    scope.check()
    await verifyFoundationSchemas(state, { bootstrap: true }); await foundationReady(state, foundation)
    await runOwned(cliSpecification(state, tools, 'server', ['integration:check', '--admin-user-id', prepared.adminUserId]), { onLog, signal: scope.signal, code: 'WEBSITE_NOT_READY', next: 'pnpm db:migrate' })
    await runOwned(cliSpecification(state, tools, 'outline', ['integration:check', '--admin-user-id', prepared.adminUserId]), { onLog, signal: scope.signal, code: 'OUTLINE_NOT_READY', next: 'pnpm infra bootstrap --admin-user-id <Website UUID>' })
    await verifyHydraClient(hydraOptions(state))
    scope.check(); scope.close()
    handedOff = true
    await supervise({ mode: 'local', fingerprint: state.fingerprint, directory: state.directory, lock, foundation: independentDependencies ? undefined : foundation,
      specifications: specifications(state, tools).filter(spec => !service || spec.name === service), onLog,
      banner: service ? `LOCAL_SERVICE_READY ${service}` : `LOCAL_READY ${state.config.publicOrigin}/`,
      readiness: async children => {
        if (!service || service === 'server') await httpReady(`http://127.0.0.1:${state.config.ports.api}/api/health`, { children })
        if (!service || service === 'outline') {
          await httpReady(`http://127.0.0.1:${state.config.ports.outline}/_health`, { children })
          await httpReady(`http://127.0.0.1:${state.config.ports.outlineVite}/docs/static/@vite/client`, { children })
        }
        if (!service) {
          await httpReady(`${state.config.publicOrigin}/api/health`, { children })
          await httpReady(`${state.config.publicOrigin}/docs/`, { children })
        } else if (service === 'web') await httpReady(`${state.config.publicOrigin}/`, { children })
      },
      prepare: independentDependencies ? undefined : adminUserId => bootstrapLocal(state, adminUserId, { lock, foundation, onLog }),
    })
  } finally { scope.close(); if (!handedOff) { if (!independentDependencies) await foundation.stopStarted(); lock.release() } }
}
function sameRun(left, right) {
  return left && right && left.runId === right.runId && left.mode === right.mode &&
    left.fingerprint === right.fingerprint && digest(left.identity) === digest(right.identity)
}
export async function controlRequest(action, mode, adminUserId, { directory = localRoot, expectedRecord, inspect = processIdentity } = {}) {
  const lockPath = join(directory, 'mode-lock.json')
  if (!existsSync(lockPath)) {
    if (expectedRecord) throw new LocalError('MODE_OWNERSHIP_CHANGED')
    return false
  }
  const record = readJson(lockPath, 'MODE_LOCK_INVALID')
  if (expectedRecord && !sameRun(record, expectedRecord)) throw new LocalError('MODE_OWNERSHIP_CHANGED')
  if (record.mode !== mode) throw new LocalError('MODE_CONTROL_CONFLICT')
  if (record.cleanupRequired || record.state === 'cleanup-failed') {
    if (action === 'stop') return false
    throw new LocalError('MODE_CLEANUP_REQUIRED', `node scripts/docs-integration/command.mjs down --mode ${mode}`)
  }
  if (record.persistent) return false
  if (!identityAlive(record.identity, inspect)) return false
  const submission = acquireLock({ mode, fingerprint: record.fingerprint, directory, name: 'control-submit-lock.json' })
  try {
  if (expectedRecord && (!existsSync(lockPath) || !sameRun(readJson(lockPath), expectedRecord))) throw new LocalError('MODE_OWNERSHIP_CHANGED')
  const requestId = randomUUID()
  atomicJson(join(directory, 'control-request.json'), { action, mode, adminUserId, requestId, runId: record.runId, fingerprint: record.fingerprint })
  const deadline = Date.now() + (action === 'stop' ? 30000 : 300000)
  while (Date.now() < deadline) {
    if (expectedRecord && existsSync(lockPath) && !sameRun(readJson(lockPath), expectedRecord)) throw new LocalError('MODE_OWNERSHIP_CHANGED')
    if (action === 'stop' && !existsSync(lockPath)) {
      if (!expectedRecord || (!identityAlive(record.identity, inspect) &&
          !(record.children ?? []).some(child => identityAlive(child.identity, inspect)))) return true
      await delay(100); continue
    }
    const responsePath = join(directory, 'control-response.json')
    if (action === 'bootstrap' && existsSync(responsePath)) {
      const response = readJson(responsePath)
      if (response.runId === record.runId && response.requestId === requestId) {
        if (response.status !== 'ready') throw new LocalError(response.code, 'retry the same explicit bootstrap command')
        return true
      }
    }
    if (!identityAlive(record.identity, inspect)) {
      // The owner may have released and exited during the identity query.
      if (expectedRecord && action === 'stop' && !existsSync(lockPath)) continue
      throw new LocalError('MODE_SUPERVISOR_EXITED')
    }
    await delay(500)
  }
  throw new LocalError('MODE_CONTROL_TIMEOUT', 'use the original terminal; do not kill stale PIDs')
  } finally { submission.release() }
}
export async function downLocal({ state, foundation, lock, directory = localRoot, inspect = processIdentity,
  control = controlRequest, externalCheck = refuseLegacyOwnership, persist = atomicJson, onLock = () => {} } = {}) {
  state ??= loadLocal(); foundation ??= new Foundation(state)
  const path = join(directory, 'mode-lock.json')
  const requested = !lock && existsSync(path) ? readJson(path, 'MODE_LOCK_INVALID') : undefined
  if (requested && (requested.mode !== 'local' || requested.fingerprint !== state.fingerprint)) throw new LocalError('MODE_CONTROL_CONFLICT')
  const history = () => ['foundation.json', 'retired-run.json'].map(name => {
    const file = join(state.directory, name)
    return existsSync(file) ? digest(readFileSync(file, 'utf8')) : null
  })
  const originalHistory = requested ? history() : undefined
  const controlled = !lock && requested && await control('stop', 'local', undefined, { directory, inspect, expectedRecord: requested })
  let registry
  const bindControlledRun = prior => {
    if (!controlled) return
    if (!requested || (prior && !sameRun(prior, requested)) || digest(history()) !== digest(originalHistory)) throw new LocalError('MODE_OWNERSHIP_CHANGED')
    const completed = validJournal(state, readJson(join(state.directory, 'run.json')))
    if (!sameRun(completed, requested)) throw new LocalError('MODE_OWNERSHIP_CHANGED')
    if (completed.state !== 'stopped' || completed.cleanupRequired || completed.children?.length) throw new LocalError('MODE_CONTROL_INCOMPLETE')
    if (identityAlive(requested.identity, inspect)) throw new LocalError('MODE_ACTIVE')
    for (const child of requested.children ?? []) if (identityAlive(child.identity, inspect)) throw new LocalError('MODE_CHILDREN_STILL_ACTIVE')
  }
  const verify = prior => {
    externalCheck(prior)
    registry ??= localRecovery(state, prior)
    if (!lock && registry.state !== 'stopped' && identityAlive(registry.identity, inspect)) throw new LocalError('MODE_ACTIVE')
    restoreLocal(state, foundation, registry)
    for (const child of registry.children ?? []) if (identityAlive(child.identity, inspect)) throw new LocalError('MODE_CHILDREN_STILL_ACTIVE')
    // This is deliberately written before the stale mode journal is replaced.
    persist(join(state.directory, 'retired-run.json'), registry)
  }
  lock ??= acquireLock({ mode: 'local', fingerprint: state.fingerprint, directory, inspect,
    externalCheck: verify, recoverCleanup: prior => {
      // Under the acquisition gate, refuse replacements before writing recovery intent.
      bindControlledRun(prior)
      registry = localRecovery(state, controlled ? requested : prior)
      return { recovery: registry, resources: registry.resources }
    } })
  onLock(lock)
  try {
    if (!registry) {
      registry = localRecovery(state, lock.record.recovery ?? lock.record)
      lock.update({ cleanupRequired: true, state: 'stopping', recovery: registry, resources: registry.resources })
      verify()
    }
    // A durable intent protects even a later failure to write cleanup-failed.
    lock.update({ cleanupRequired: true, state: 'stopping', recovery: registry, resources: registry.resources })
    persist(join(state.directory, 'run.json'), { ...registry, state: 'stopping', cleanupRequired: true })
    await foundation.stopStarted()
    restoreLocal(state, foundation, registry)
    foundation.verifyStopped()
    persist(join(state.directory, 'run.json'), { ...registry, state: 'stopped', stoppedAt: new Date().toISOString(), cleanupRequired: false })
    lock.update({ state: 'stopped', cleanupRequired: false })
    lock.release()
  } catch (error) {
    try { lock.update({ state: 'cleanup-failed', cleanupRequired: true, recovery: registry, resources: registry?.resources ?? lock.record.resources }) } catch {}
    try { if (registry) persist(join(state.directory, 'run.json'), { ...registry, state: 'cleanup-failed', cleanupRequired: true }) } catch {}
    throw error
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (process.argv.length !== 2) throw new LocalError('LOCAL_ARGUMENTS_INVALID'); await runLocal() }
  catch (error) { console.error(error instanceof LocalError ? error.message : 'LOCAL_START_FAILED; next: inspect explicit local preparation'); process.exitCode = 1 }
}
