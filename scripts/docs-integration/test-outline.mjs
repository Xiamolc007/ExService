import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** Requires explicit, literal test cases instead of allowing the full server suite. */
export function testSelection(args) {
  const [file, ...cases] = args
  if (!file || !/^(?:server|plugins)\/(?:[\w.-]+\/)*[\w.-]+\.test\.tsx?$/.test(file) ||
      !cases.length || cases.some(name => !name.trim() || /[\r\n]/.test(name))) {
    throw new Error('Provide one server/plugins test file and one or more literal test case names.')
  }
  return { file, cases }
}

/** Keeps only operating-system and package-cache settings, then supplies disposable service credentials. */
export function isolatedEnvironment(inherited, { databaseUrl, redisUrl, storage, node }) {
  const allowed = new Set([
    'PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP',
    'USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
    'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'COMMONPROGRAMFILES',
    'COMMONPROGRAMFILES(X86)', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
    'COREPACK_HOME', 'COREPACK_ENABLE_DOWNLOAD_PROMPT', 'PNPM_HOME',
    'YARN_CACHE_FOLDER', 'NPM_CONFIG_CACHE', 'CI', 'TERM', 'NO_COLOR', 'FORCE_COLOR',
  ])
  const environment = Object.fromEntries(Object.entries(inherited).filter(([key]) =>
    allowed.has(key.toUpperCase()) && key.toUpperCase() !== 'PATH'))
  const inheritedPath = Object.entries(inherited).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? ''
  return {
    ...environment, NODE_ENV: 'test', TZ: 'UTC', DATABASE_URL: databaseUrl,
    DATABASE_SCHEMA: 'public', DATABASE_CONNECTION_POOL_URL: '', PGSSLMODE: 'disable',
    REDIS_URL: redisUrl, REDIS_COLLABORATION_URL: redisUrl,
    FILE_STORAGE: 'local', FILE_STORAGE_LOCAL_ROOT_DIR: storage,
    WEBSITE_INTEGRATION_ENABLED: 'true', RATE_LIMITER_ENABLED: 'false', SSL_CERT_FILE: '',
    SECRET_KEY: '0123456789abcdef'.repeat(4), UTILS_SECRET: 'isolated-utils-test-secret',
    WEBSITE_INTERNAL_URL: 'http://127.0.0.1:1', HYDRA_PUBLIC_URL: 'http://127.0.0.1:1/',
    OUTLINE_INTEGRATION_KEY: 'isolated-outline-test-key',
    OUTLINE_OIDC_CLIENT_ID: 'isolated-outline-test-client',
    OUTLINE_OIDC_CLIENT_SECRET: 'isolated-oidc-test-secret',
    PATH: `${dirname(node)}${delimiter}${inheritedPath}`,
  }
}

async function run(node, corepack, args, environment, log) {
  const stream = createWriteStream(log)
  try {
    const child = spawn(node, [corepack, 'yarn', ...args], {
      cwd: resolve(root, 'apps/outline'), env: environment, shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.pipe(stream, { end: false })
    child.stderr.pipe(stream, { end: false })
    return await new Promise((done, reject) => {
      child.once('error', reject)
      child.once('close', done)
    })
  } finally {
    await new Promise(done => stream.end(done))
  }
}

async function main(args) {
  const { file, cases } = testSelection(args)
  const outline = realpathSync(resolve(root, 'apps/outline'))
  const target = realpathSync(resolve(outline, file))
  if (!target.startsWith(`${outline}${sep}`)) throw new Error('Test file is outside the Outline checkout.')
  const node = process.env.INTEGRATION_NODE_BIN || resolve(root, '.local/docs-integration/tools/node26/node-v26.3.0-win-x64/node.exe')
  const corepack = process.env.INTEGRATION_COREPACK_JS || resolve(dirname(process.execPath), 'node_modules/corepack/dist/corepack.js')
  if (!existsSync(node) || !existsSync(corepack)) {
    throw new Error('Set INTEGRATION_NODE_BIN and INTEGRATION_COREPACK_JS to the local Node 26 and Corepack executables.')
  }
  const require = createRequire(resolve(root, 'package.json'))
  const { PostgreSqlContainer } = require('@testcontainers/postgresql')
  const { GenericContainer, Wait } = createRequire(require.resolve('@testcontainers/postgresql'))('testcontainers')
  const { Client } = require('pg')
  const images = JSON.parse(readFileSync(resolve(root, 'infra/docs-integration/images.lock.json'), 'utf8'))
  const output = resolve(root, 'output/docs-integration-team/outline-tests', randomUUID())
  mkdirSync(output, { recursive: true })
  console.log(`Isolated Outline test logs: ${relative(root, output)}`)
  for (const [index, name] of cases.entries()) {
    let postgres, redis, client
    try {
      postgres = await new PostgreSqlContainer(images.postgres)
        .withDatabase('outline-test').withUsername('user').withPassword(randomBytes(24).toString('hex')).start()
      redis = await new GenericContainer(images.redis).withExposedPorts(6379)
        .withWaitStrategy(Wait.forLogMessage('Ready to accept connections')).start()
      client = new Client({ connectionString: postgres.getConnectionUri() })
      await client.connect()
      const identity = await client.query('SELECT current_database() AS name')
      if (identity.rows[0].name !== 'outline-test') throw new Error('Disposable test database identity mismatch.')
      for (const extension of ['uuid-ossp', 'unaccent', 'pg_trgm', 'btree_gin']) {
        await client.query(`CREATE EXTENSION IF NOT EXISTS "${extension}" WITH SCHEMA public`)
      }
      const storage = resolve(output, `${index}-storage`)
      mkdirSync(storage)
      const environment = isolatedEnvironment(process.env, {
        databaseUrl: postgres.getConnectionUri(), redisUrl: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
        storage, node,
      })
      const migration = await run(node, corepack, ['db:migrate', '--env', 'test'], environment, resolve(output, `${index}-migration.log`))
      if (migration !== 0) throw new Error(`Case ${index}: migration failed; see the isolated log.`)
      const report = resolve(output, `${index}-report.json`)
      const pattern = `${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
      const result = await run(node, corepack, ['vitest', 'run', file, '--project', 'server', '--maxWorkers', '1',
        '--no-file-parallelism', '--dangerouslyIgnoreUnhandledErrors=false',
        '--testNamePattern', pattern, '--reporter', 'json', '--outputFile', report],
      environment, resolve(output, `${index}-test.log`))
      const evidence = JSON.parse(readFileSync(report, 'utf8'))
      const executed = evidence.testResults.flatMap(entry => entry.assertionResults)
        .filter(entry => !['pending', 'skipped', 'todo'].includes(entry.status))
      if (result !== 0 || executed.length !== 1 || executed[0].status !== 'passed' ||
          ![executed[0].title, executed[0].fullName].includes(name)) {
        throw new Error(`Case ${index}: expected exactly one passing test; see the isolated report.`)
      }
      console.log(`PASS ${file}: ${name}`)
    } finally {
      const cleanup = await Promise.allSettled([
        client?.end(), redis?.stop(), postgres?.stop(),
      ])
      if (cleanup.some(result => result.status === 'rejected')) {
        throw new Error('Disposable test resource cleanup failed; inspect Docker before retrying.')
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
