import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { runOwned, acquireLock, signalScope, spawnOwned, stopOwned } from '../docs-integration/ownership.mjs'
import { toolchain } from '../docs-integration/local-config.mjs'
import { httpReady, assertPortFree, validUuid, verifyFoundationSchemas } from '../docs-integration/local-dev.mjs'
import { ensureHydraClient } from '../docs-integration/hydra-client.mjs'
import { RuntimeError, diagnostic, reporter } from './output.mjs'
import { Services } from './services.mjs'
import { cliSpecification, hydraOptions } from './applications.mjs'
import { validateDeployment } from './deployment.mjs'

/** Creates only missing local document databases, never exre or existing role passwords. */
export async function initializeDocumentDatabases(state, { connect } = {}) {
  if (state.profile !== 'local') return // Native services are explicitly provisioned by their operator.
  const { default: pg } = await import('pg')
  const client = connect ? await connect() : new pg.Client({ host: '127.0.0.1', port: state.config.ports.postgres,
    database: 'postgres', user: state.values.POSTGRES_USER ?? 'postgres', password: state.values.POSTGRES_PASSWORD, connectionTimeoutMillis: 3000 })
  try {
    if (!connect) await client.connect()
    const plans = []
    for (const name of ['outline', 'hydra']) {
      const prefix = `${name.toUpperCase()}_DATABASE`, user = state.values[`${prefix}_USER`]
      if (user === (state.values.POSTGRES_USER ?? 'postgres') || user === 'postgres' || user === state.values.DATABASE_USER) throw new RuntimeError('DATABASE_OWNER_CONFLICT', { service: name })
      const role = (await client.query('SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1', [user])).rows[0]
      const database = (await client.query('SELECT r.rolname AS owner FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname=$1', [name])).rows[0]
      if (database && database.owner !== user || role && (!role.rolcanlogin || role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.rolbypassrls))
        throw new RuntimeError('DATABASE_OWNER_CONFLICT', { service: name })
      plans.push({ name, user, prefix, createRole: !role, createDatabase: !database })
    }
    if (plans[0].user === plans[1].user) throw new RuntimeError('DATABASE_OWNER_CONFLICT')
    for (const plan of plans) {
      if (plan.createRole) await client.query(`CREATE ROLE ${pg.escapeIdentifier(plan.user)} LOGIN PASSWORD ${pg.escapeLiteral(state.values[`${plan.prefix}_PASSWORD`])}`)
      if (plan.createDatabase) await client.query(`CREATE DATABASE ${pg.escapeIdentifier(plan.name)} OWNER ${pg.escapeIdentifier(plan.user)}`)
    }
  } catch (error) { throw diagnostic(error, { service: 'PostgreSQL', phase: '显式准备文档库', keys: ['POSTGRES_PASSWORD'], next: '检查数据库 owner 与原凭据；重复 init 不修改既有角色密码' }) }
  finally { await client.end().catch(() => {}) }
}

export function hydraSpecification(state, args) {
  const binary = state.values.HYDRA_BINARY
  if (!binary || !existsSync(binary)) throw new RuntimeError('HYDRA_BINARY_REQUIRED', { keys: ['HYDRA_BINARY'] })
  return { name: 'Hydra', command: binary, args, cwd: state.workspace, environment: state.environments.hydra }
}

/** Native protocol service must match the locked container version before any preparation/start. */
export function verifyHydraBinary(state, run = spawnSync) {
  const specification = hydraSpecification(state, ['version'])
  const result = run(specification.command, specification.args, { cwd: state.workspace, env: state.inherited,
    encoding: 'utf8', shell: false, windowsHide: true, timeout: 10000 })
  if (result.error || result.status !== 0 || !/\bVersion:\s*v?2\.3\.0(?:\s|$)/i.test(result.stdout ?? ''))
    throw new RuntimeError('HYDRA_VERSION_CONFLICT', { service: 'Hydra', keys: ['HYDRA_BINARY'], next: '安装与本地镜像一致的 Hydra v2.3.0' })
}

/** Explicit migration, with identical application credentials for native and local targets. */
export async function prepareInfrastructure(state, { migrateOnly = false, execute = runOwned } = {}) {
  const tools = toolchain({ workspace: state.workspace, inherited: state.values }), output = reporter({ environment: state.values })
  const lock = acquireLock({ mode: 'local', fingerprint: state.fingerprint, directory: state.directory, name: 'applications-lock.json' })
  const scope = signalScope()
  try {
    if (state.profile === 'local') {
      const services = new Services(state)
      services.verify(services.inventory()); services.verifyVolumes()
      await services.start({ selectedServices: ['postgres', 'redis'], log: output })
      if (!migrateOnly) await initializeDocumentDatabases(state)
      services.compose(['run', '--rm', '--no-deps', 'hydra', 'migrate', 'sql', 'up', '--read-from-env', '--yes'])
    } else {
      verifyHydraBinary(state)
      await execute(hydraSpecification(state, ['migrate', 'sql', 'up', '--read-from-env', '--yes']), { signal: scope.signal,
        onLog: output.log, code: 'HYDRA_MIGRATION_FAILED' })
    }
    await output.stage('Outline migration', onLog => execute({ name: 'Outline', command: tools.node,
      args: [tools.corepack, 'yarn', 'db:migrate', '--env', state.values.OUTLINE_DATABASE_SSLMODE === 'disable' || state.profile === 'local' ? 'production-ssl-disabled' : 'production'],
      cwd: join(state.workspace, 'apps/outline'), environment: state.environments.outline }, { signal: scope.signal, onLog }))
    if (!existsSync(join(state.workspace, 'apps/outline/build/server/scripts/integration-check.js')))
      await output.stage('Outline server build', onLog => execute({ name: 'Outline', command: tools.node, args: [tools.corepack, 'yarn', 'build:server'],
        cwd: join(state.workspace, 'apps/outline'), environment: state.environments.outline }, { signal: scope.signal, onLog }))
    await verifyFoundationSchemas(state)
    if (state.profile === 'deployment') await validateDeployment(state, { prepare: true })
    output.title('文档基础设施准备完成；Website 迁移仍须显式 pnpm db:migrate')
  } finally { scope.close(); lock.release() }
}

export async function bootstrapInfrastructure(state, adminUserId) {
  if (!validUuid(adminUserId)) throw new RuntimeError('BOOTSTRAP_UUID_REQUIRED')
  const tools = toolchain({ workspace: state.workspace, inherited: state.values }), output = reporter({ environment: state.values })
  const lock = acquireLock({ mode: 'local', fingerprint: state.fingerprint, directory: state.directory, name: 'applications-lock.json' })
  const scope = signalScope()
  let temporary
  try {
    await verifyFoundationSchemas(state)
    if (state.profile === 'deployment') await validateDeployment(state, { prepare: true })
    await runOwned(cliSpecification(state, tools, 'server', 'integration:check', ['--admin-user-id', adminUserId]), { signal: scope.signal, onLog: output.log })
    const port = Number(state.environments.server.SERVER_PORT)
    await assertPortFree(port)
    const compiled = state.profile === 'deployment'
    temporary = await spawnOwned({ name: 'Website bootstrap', command: tools.node, cwd: join(state.workspace, 'apps/server'),
      args: compiled ? ['dist/server.js'] : ['--import', 'tsx', 'src/server.ts'], environment: state.environments.server }, { signal: scope.signal, onLog: output.log })
    await httpReady(new URL('/api/health', state.internal.website), { children: [temporary], timeout: 30000 })
    await ensureHydraClient(hydraOptions(state))
    await runOwned(cliSpecification(state, tools, 'outline', 'integration-bootstrap', ['--admin-user-id', adminUserId]), { signal: scope.signal, onLog: output.log })
    await runOwned(cliSpecification(state, tools, 'outline', 'integration-check', ['--admin-user-id', adminUserId]), { signal: scope.signal, onLog: output.log })
    output.title('文档身份准备完成；重复准备不会恢复已撤销管理员权限')
  } finally { scope.close(); if (temporary) await stopOwned([temporary]); lock.release() }
}
