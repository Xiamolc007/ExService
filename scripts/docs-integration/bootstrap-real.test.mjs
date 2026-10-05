import assert from 'node:assert/strict'
import test from 'node:test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { root } from './configure.mjs'
import { configureLocal, defaults, toolchain } from './local-config.mjs'
import { Foundation } from './foundation.mjs'
import { acquireLock, runOwned } from './ownership.mjs'
import { assertPortFree, bootstrapLocal, cliSpecification, foundationReady, hydraOptions, savePrepared, verifyFoundationSchemas } from './local-dev.mjs'
import { verifyHydraClient } from './hydra-client.mjs'

async function unusedPort() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port
}
function copy(source, destination) { mkdirSync(join(destination, '..'), { recursive: true }); cpSync(source, destination, { recursive: true }) }
function link(source, destination) { mkdirSync(join(destination, '..'), { recursive: true }); symlinkSync(source, destination, process.platform === 'win32' ? 'junction' : 'dir') }
test('real disposable bootstrap uses only an explicit fixture UUID and always cleans its temporary Website process', { timeout: 300000 }, async () => {
  // Use a dedicated ignored directory on the workspace drive for observable bind identities.
  const workspace = mkdtempSync(join(root, '.local/docs-integration/local-bootstrap-')), directory = join(workspace, '.local/docs-integration/local-dev')
  const project = `exwebsite-local-test-${randomUUID().slice(0, 8)}`
  let websiteContainer, foundation, client, lock
  const logs = [], onLog = (name, line) => logs.push(`[${name}] ${line}`)
  try {
    // Runtime files are copied so Website storage startup cannot touch host data directories.
    for (const path of ['apps/server/src', 'apps/server/dist', 'apps/server/drizzle', 'apps/server/package.json', 'apps/server/tsconfig.json',
      'tsconfig.base.json', 'tsconfig.json', 'api', 'compose.local-dev.yaml', 'infra/docs-integration/images.lock.json', 'infra/docs-integration/postgres/init-local.sh'])
      copy(join(root, path), join(workspace, path))
    link(join(root, 'node_modules'), join(workspace, 'node_modules'))
    link(join(root, 'apps/server/node_modules'), join(workspace, 'apps/server/node_modules'))
    link(join(root, 'apps/outline/node_modules'), join(workspace, 'apps/outline/node_modules'))
    for (const path of ['build', 'server/migrations', 'server/config/database.js', 'package.json', 'yarn.lock', '.yarnrc.yml', '.sequelizerc', '.yarn/install-state.gz'])
      if (existsSync(join(root, 'apps/outline', path))) copy(join(root, 'apps/outline', path), join(workspace, 'apps/outline', path))
    writeFileSync(join(workspace, 'package.json'), JSON.stringify({ private: true, type: 'module', packageManager: 'pnpm@11.9.0' }))
    writeFileSync(join(workspace, 'pnpm-workspace.yaml'), 'packages:\n  - apps/server\nverifyDepsBeforeRun: false\n')
    websiteContainer = await new PostgreSqlContainer('postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea').withDatabase('exre').start()
    const database = new URL(websiteContainer.getConnectionUri()); if (database.hostname === 'localhost') database.hostname = '127.0.0.1'
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COREPACK_HOME', 'PNPM_HOME'].includes(key.toUpperCase())))
    Object.assign(inherited, { DATABASE_URL: database.href, AUTH_CODE_HMAC_KEY: 'a'.repeat(64), STORAGE_DEFAULT_ADAPTER: 'file',
      SERVER_AVATAR_DIRECTORY: join(directory, 'fixture-avatars'), SERVER_CORS_ALLOWED_ORIGINS: '',
      TENCENT_COS_SECRET_ID: '', TENCENT_COS_SECRET_KEY: '', TENCENT_COS_REGION: '', TENCENT_COS_BUCKET: '' })
    const ports = {}, used = new Set()
    for (const name of Object.keys(defaults)) { do { ports[name] = await unusedPort() } while (used.has(ports[name])); used.add(ports[name]) }
    // Configure runs successfully while the disposable Website has no migration/schema.
    const state = await configureLocal({ workspace, directory, inherited, ports })
    const tools = toolchain({ workspace, inherited })
    await runOwned(cliSpecification(state, tools, 'server', ['db:migrate']), { onLog })
    client = new pg.Client({ connectionString: database.href }); await client.connect()
    const admin = randomUUID(), disabled = randomUUID()
    await client.query("INSERT INTO auth_users(id,email,nickname,password_hash,created_at,disabled_at) VALUES($1,$2,'Fixture','fixture-hash',$3,NULL),($4,$5,'Disabled','fixture-hash',$3,$3)",
      [admin, `${admin}@example.test`, Date.now(), disabled, `${disabled}@example.test`])
    foundation = new Foundation(state, { project }); foundation.preflight(false)
    await foundation.start(['postgres', 'redis'])
    foundation.compose(['exec', '-T', 'postgres', 'sh', '/docker-entrypoint-initdb.d/10-local-databases.sh'])
    foundation.compose(['run', '--rm', '--no-deps', 'hydra', 'migrate', 'sql', 'up', '--read-from-env', '--yes'])
    await runOwned(cliSpecification(state, tools, 'outline', ['db:migrate', '--env', 'production-ssl-disabled']), { onLog })
    await verifyFoundationSchemas(state)
    savePrepared(state, { volumes: foundation.verifyVolumes(), stages: { initialized: true } })
    await foundation.start(['hydra']); await foundationReady(state, foundation)
    await assert.rejects(verifyHydraClient(hydraOptions(state)))
    lock = acquireLock({ mode: 'local', fingerprint: state.fingerprint, directory: join(directory, 'locks') })
    for (const subject of [disabled, randomUUID()]) {
      await assert.rejects(bootstrapLocal(state, subject, { lock, foundation, onLog }), /WEBSITE_NOT_READY/)
      await assertPortFree(ports.api)
      assert.equal(lock.record.temporary, null)
    }
    const beforeUsers = (await client.query('SELECT count(*) AS count FROM auth_users')).rows[0].count
    await bootstrapLocal(state, admin, { lock, foundation, onLog })
    await assertPortFree(ports.api)
    assert.equal(lock.record.temporary, null)
    await verifyHydraClient(hydraOptions(state))
    await bootstrapLocal(state, admin, { lock, foundation, onLog })
    await assertPortFree(ports.api)
    assert.equal((await client.query('SELECT count(*) AS count FROM auth_users')).rows[0].count, beforeUsers)
    // A conflicting initial administrator fails after temporary startup and still cleans it.
    const conflict = randomUUID()
    await client.query("INSERT INTO auth_users(id,email,nickname,password_hash,created_at) VALUES($1,$2,'Other','fixture-hash',$3)", [conflict, `${conflict}@example.test`, Date.now()])
    await assert.rejects(bootstrapLocal(state, conflict, { lock, foundation, onLog }), /OUTLINE_BOOTSTRAP_FAILED/)
    await assertPortFree(ports.api); assert.equal(lock.record.temporary, null)
    const occupied = createServer(); await new Promise(resolve => occupied.listen(ports.api, '127.0.0.1', resolve))
    try { await assert.rejects(bootstrapLocal(state, admin, { lock, foundation, onLog }), /PORT_OCCUPIED/) }
    finally { await new Promise(resolve => occupied.close(resolve)) }
    console.log(JSON.stringify({ project, website: 'isolated exre', explicitFixtureAdministrator: true,
      rejectedDisabledAbsentConflictAndOccupiedPort: true, repeatedBootstrapStable: true, temporaryProcessCleaned: true }))
  } catch (error) {
    console.log(logs.slice(-15).join('\n')); throw error
  } finally {
    writeFileSync(join(root, '.local/docs-integration/task-unit/local-bootstrap-children.log'), logs.join('\n') + '\n')
    lock?.release(); await client?.end(); if (foundation) foundation.compose(['down', '--volumes', '--remove-orphans'], true)
    await websiteContainer?.stop(); rmSync(workspace, { recursive: true, force: true })
  }
})
