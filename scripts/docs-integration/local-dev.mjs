import { createServer } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'
import { existsSync, readdirSync } from 'node:fs'
import { join, dirname, delimiter } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { diagnostic, RuntimeError } from '../runtime/output.mjs'
import { atomicJson, LocalError, readJson, toolchain } from './local-config.mjs'
import { spawnOwned, stopOwned } from './ownership.mjs'

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
  const target = new URL(url)
  throw new RuntimeError('APPLICATION_NOT_READY', { service: '应用', phase: 'HTTP 健康检查', target: `${target.origin}${target.pathname}` })
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
function applicationEnvironments(state, tools) {
  return Object.fromEntries(Object.entries(state.environments).map(([service, environment]) => {
    const path = Object.entries(environment).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? ''
    return [service, { ...Object.fromEntries(Object.entries(environment).filter(([key]) => key.toUpperCase() !== 'PATH')),
      PATH: `${dirname(tools.node)}${delimiter}${path}` }]
  }))
}
export async function verifyFoundationSchemas(state, { bootstrap = false } = {}) {
  const { default: pg } = await import('pg')
  for (const name of ['outline', 'hydra']) {
    const prefix = `${name.toUpperCase()}_DATABASE`
    const expectedOwner = state.values[`${prefix}_USER`]
    const client = new pg.Client({ connectionString: state.databases[prefix], connectionTimeoutMillis: 3000 })
    try {
      await client.connect(); await client.query('BEGIN READ ONLY')
      const identity = await client.query('SELECT current_database() AS name, current_user AS owner')
      if (identity.rows[0]?.name !== name || identity.rows[0]?.owner !== expectedOwner) throw new RuntimeError('DATABASE_IDENTITY_CONFLICT', { service: name })
      const unsafe = await client.query('SELECT d.datname FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname=$1 AND r.rolname<>$2', [name, expectedOwner])
      const roles = await client.query('SELECT rolname FROM pg_roles WHERE rolname=$1 AND (NOT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)', [expectedOwner])
      if (unsafe.rows.length || roles.rows.length) throw new RuntimeError('DATABASE_OWNER_CONFLICT', { service: name, keys: [`${prefix}_USER`] })
      if (name === 'outline') {
        const migrations = new Set((await client.query('SELECT name FROM "SequelizeMeta"')).rows.map(row => row.name))
      const missingMigrations = readdirSync(join(state.workspace, 'apps/outline/server/migrations')).filter(file => file.endsWith('.js') && !migrations.has(file))
      if (missingMigrations.length) throw new RuntimeError('DATABASE_MIGRATIONS_MISSING', { service: name, target: missingMigrations.join(', ') })
        const columns = new Set((await client.query('SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=current_schema()')).rows.map(row => `${row.table_name}.${row.column_name}`))
        for (const column of ['teams.id', 'users.id', 'website_integrations.issuer', 'website_integrations.initialAdminSubject',
          'external_identities.issuer', 'external_sessions.clientId', 'external_revocation_events.eventId']) if (!columns.has(column))
          throw new RuntimeError('DATABASE_STRUCTURE_INCOMPLETE', { service: name, target: column })
        const extensions = new Set((await client.query('SELECT extname FROM pg_extension')).rows.map(row => row.extname))
      if (!extensions.has('pg_trgm')) throw new RuntimeError('OUTLINE_EXTENSION_MISSING', { service: name })
        const markers = (await client.query('SELECT issuer,"initialAdminSubject" FROM website_integrations')).rows
      if (markers.length > 1 || (markers.length && markers[0].issuer !== state.config.issuer))
        throw new RuntimeError('OUTLINE_IDENTITY_CONFLICT', { service: name, keys: ['HYDRA_PUBLIC_URL'] })
      if (bootstrap && !markers.length) throw new RuntimeError('OUTLINE_MARKER_MISSING', { service: name })
      } else {
        const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND (tablename LIKE 'hydra_%' OR tablename='schema_migration')")).rows
      if (!tables.some(row => row.tablename === 'hydra_client') || !tables.some(row => /migration/.test(row.tablename)))
        throw new RuntimeError('DATABASE_MIGRATIONS_MISSING', { service: name })
      }
      await client.query('ROLLBACK')
    } catch (error) {
      throw diagnostic(error, { service: name, phase: '数据库结构和身份检查', keys: [`${prefix}_HOST`, `${prefix}_PORT`, `${prefix}_USER`, `${prefix}_PASSWORD`], next: '先检查连接配置；结构缺失时显式 pnpm infra migrate' })
    }
    finally { await client.end().catch(() => {}) }
  }
}
/** Owns application children and retains ownership until cleanup completes. */
export async function supervise({ mode, fingerprint, directory, specifications: specs, lock, readiness,
  onLog = (name, line) => console.log(`[${name}] ${line}`), banner, onReady = () => console.log(banner),
  spawnChild = spawnOwned, stopChildren = stopOwned, pollInterval = 250, controlDirectory = directory }) {
  let children = [], stopping = false, generation = 0, state = 'starting', failure
  const runPath = join(directory, 'run.json'), requestPath = join(controlDirectory, 'control-request.json')
  const persist = () => {
    const value = { version: 1, mode, runId: lock.record.runId, fingerprint, identity: lock.record.identity, state,
      children: children.map(child => ({ name: child.specification.name, identity: child.identity })),
      resources: { started: [], preRunning: [], createdStopped: [], containerProofs: [] } }
    atomicJson(runPath, value); lock.update(value)
  }
  const stopSignal = () => { stopping = true }
  process.on('SIGINT', stopSignal); process.on('SIGTERM', stopSignal)
  const launch = async () => {
    if (stopping) throw new LocalError('RUN_INTERRUPTED')
    generation++; const current = generation
    state = 'starting'; persist()
    for (const spec of specs) {
      const child = await spawnChild(spec, { onLog }); children.push(child)
      child.exited.then(result => {
        if (current === generation && !stopping) failure = new LocalError(`APP_${spec.name.toUpperCase()}_EXITED_${result.code ?? 'SIGNAL'}`)
      })
      persist()
    }
    await readiness(children)
    if (failure) throw failure
    state = 'ready'; persist()
    onReady()
  }
  try {
    await launch()
    while (!stopping) {
      if (failure) throw failure
      if (existsSync(requestPath)) {
        const request = readJson(requestPath, 'CONTROL_REQUEST_INVALID')
        if (request.runId === lock.record.runId) {
          if (request.action === 'stop') { stopping = true; continue }
        }
      }
      await delay(pollInterval)
    }
  } finally {
    generation++; stopping = true; state = 'stopping'
    lock.update({ state, cleanupRequired: true }); persist()
    try {
      await stopChildren(children)
      children = []; state = 'stopped'; persist(); lock.update({ cleanupRequired: false }); lock.release()
    } catch (error) { state = 'cleanup-failed'; try { lock.update({ state, cleanupRequired: true }) } catch {}; persist(); throw error }
    finally { process.off('SIGINT', stopSignal); process.off('SIGTERM', stopSignal) }
  }
}
