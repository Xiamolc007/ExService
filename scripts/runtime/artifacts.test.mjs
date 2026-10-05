import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { root } from '../docs-integration/configure.mjs'
import { operatingEnvironment } from './configuration.mjs'
import { prepareImageContext } from './image-context.mjs'
import { serializeEnvironment } from './configure.mjs'

test('image source context omits host modules, env and generated artifacts and refuses existing destination', t => {
  const directory = mkdtempSync(join(tmpdir(), 'runtime-image-context-')), source = join(directory, 'source'), target = join(directory, 'context')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  for (const path of ['packages/components', 'packages/tokens', 'packages/components/node_modules', 'packages/components/dist']) mkdirSync(join(source, path), { recursive: true })
  for (const path of ['package.json', 'packages/components/package.json', 'packages/tokens/package.json', 'packages/components/.env.local', 'packages/components/node_modules/secret', 'packages/components/dist/generated']) writeFileSync(join(source, path), '{}')
  prepareImageContext(source, target)
  assert.equal(existsSync(join(target, 'packages/components/package.json')), true)
  for (const path of ['packages/components/.env.local', 'packages/components/node_modules', 'packages/components/dist']) assert.equal(existsSync(join(target, path)), false)
  assert.throws(() => prepareImageContext(source, target), /IMAGE_CONTEXT_INVALID/)
})
test('deployment Compose uses exact service maps, no application env_file or implicit migrate/dev', t => {
  const environment = { ...operatingEnvironment(), WEBSITE_SERVER_IMAGE: 'website:test', OUTLINE_IMAGE: 'outline:test',
    DATABASE_URL: 'postgres://website:literal${DO_NOT_EXPAND}@postgres/exre', OUTLINE_DATABASE_URL: 'postgres://outline:fixture@postgres/outline',
    HYDRA_DATABASE_URL: 'postgres://hydra:fixture@postgres/hydra', OUTLINE_REDIS_URL: 'redis://redis:6379', PUBLIC_ORIGIN: 'https://site.example',
    HYDRA_PUBLIC_URL: 'https://issuer.example/', HYDRA_ADMIN_URL: 'http://hydra:4445/', WEBSITE_INTERNAL_URL: 'http://server:8080/',
    OUTLINE_INTERNAL_URL: 'http://outline:3000/', OUTLINE_STORAGE_DIRECTORY: '/var/lib/outline', AUTH_CODE_HMAC_KEY: 'a'.repeat(64),
    ...Object.fromEntries(['POSTGRES_PASSWORD', 'OUTLINE_SECRET_KEY', 'OUTLINE_UTILS_SECRET', 'HYDRA_SYSTEM_SECRET', 'OUTLINE_OIDC_CLIENT_SECRET',
      'OUTLINE_INTEGRATION_KEY', 'IDENTITY_BOOTSTRAP_KEY', 'IDENTITY_FLOW_KEY', 'IDENTITY_DELIVERY_KEY'].map(key => [key, 'b'.repeat(64)])) }
  const directory = mkdtempSync(join(tmpdir(), 'runtime-compose-env-')), file = join(directory, '.env.local')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  writeFileSync(file, serializeEnvironment(environment))
  const result = spawnSync('docker', ['compose', '--env-file', file, '-f', 'compose.production.yaml', '--profile', 'maintenance', 'config', '--format', 'json'],
    { cwd: root, env: { ...operatingEnvironment(), DO_NOT_EXPAND: 'would-corrupt-password' }, encoding: 'utf8', shell: false, windowsHide: true })
  assert.equal(result.status, 0, 'Compose parsing must succeed without starting infrastructure')
  const value = JSON.parse(result.stdout), services = value.services
  // Compose renders literal dollars escaped so the generated config can itself be re-read.
  assert.equal(services.server.environment.DATABASE_URL, environment.DATABASE_URL.replaceAll('$', () => '$$'))
  assert.equal(services.outline.environment.DATABASE_URL, environment.OUTLINE_DATABASE_URL)
  assert.equal(services.hydra.environment.DSN, environment.HYDRA_DATABASE_URL)
  assert.equal(services.hydra.command.includes('--dev'), false)
  assert.equal(services.outline.command.includes('--no-migrate'), true)
  assert.equal(services.server.environment.IDENTITY_OUTBOX_TARGETS_JSON, '{}')
  assert.match(JSON.stringify(services.server.extra_hosts), /host\.docker\.internal.*host-gateway/)
  for (const service of [services.server, services.outline, services.hydra]) assert.equal(service.env_file, undefined)
  assert.equal(services.outline.environment.AUTH_CODE_HMAC_KEY, undefined)
  assert.equal(services.hydra.environment.OUTLINE_INTEGRATION_KEY, undefined)
  assert.equal(Object.keys(services).includes('web'), false)
  const ignore = readFileSync(join(root, '.dockerignore'), 'utf8')
  assert.ok(ignore.includes('**/.env.local')); assert.ok(ignore.includes('.env.local.command-runtime.tmp'))
})
