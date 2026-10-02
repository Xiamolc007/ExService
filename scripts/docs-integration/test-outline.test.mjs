import assert from 'node:assert/strict'
import test from 'node:test'
import { isolatedEnvironment, testSelection } from './test-outline.mjs'

test('requires one explicit server file and literal case names before starting containers', () => {
  for (const args of [[], ['server/models/User.test.ts'], ['../other.test.ts', 'case'], ['server', 'case']]) {
    assert.throws(() => testSelection(args))
  }
  assert.deepEqual(testSelection(['server/models/User.test.ts', 'literal .* case']), {
    file: 'server/models/User.test.ts', cases: ['literal .* case'],
  })
  assert.equal(testSelection(['plugins/storage/server/api/files.test.ts', 'case']).file,
    'plugins/storage/server/api/files.test.ts')
})

test('replaces inherited database and Redis connections and private service credentials', () => {
  const inherited = { PATH: 'fixture', DATABASE_URL: 'existing-db', DATABASE_READ_ONLY_URL: 'existing-reader',
    DATABASE_HOST: 'existing-host', PGHOST: 'existing-host', REDIS_URL: 'existing-redis',
    REDIS_COLLABORATION_URL: 'existing-collaboration', WEBSITE_INTERNAL_KEY: 'existing-secret',
    IDENTITY_DELIVERY_KEY: 'existing-secret', IDENTITY_ISSUER: 'http://existing-identity',
    OUTLINE_INTEGRATION_KEY: 'existing-secret', OUTLINE_OIDC_CLIENT_SECRET: 'existing-secret',
    SECRET_KEY: 'existing-secret', SECRET_KEY_FILE: '/existing-secret', UTILS_SECRET: 'existing-secret',
    AUTH_CODE_HMAC_KEY: 'existing-secret', AWS_SECRET_ACCESS_KEY: 'existing-secret',
    NODE_OPTIONS: '--require=/existing-startup.js', TEMP: '/fixture/temp',
    COREPACK_HOME: '/fixture/corepack' }
  const environment = isolatedEnvironment(inherited, {
    databaseUrl: 'postgres://fixture', redisUrl: 'redis://fixture', storage: '/fixture/storage', node: process.execPath,
  })
  assert.equal(environment.DATABASE_URL, 'postgres://fixture')
  assert.equal(environment.DATABASE_SCHEMA, 'public')
  assert.equal(environment.DATABASE_CONNECTION_POOL_URL, '')
  assert.equal(environment.REDIS_URL, 'redis://fixture')
  assert.equal(environment.REDIS_COLLABORATION_URL, 'redis://fixture')
  assert.equal(environment.FILE_STORAGE_LOCAL_ROOT_DIR, '/fixture/storage')
  for (const key of ['DATABASE_READ_ONLY_URL', 'DATABASE_HOST', 'PGHOST', 'WEBSITE_INTERNAL_KEY',
    'IDENTITY_DELIVERY_KEY', 'IDENTITY_ISSUER', 'SECRET_KEY_FILE', 'AUTH_CODE_HMAC_KEY',
    'AWS_SECRET_ACCESS_KEY', 'NODE_OPTIONS']) {
    assert.equal(environment[key], undefined)
  }
  assert.equal(environment.WEBSITE_INTERNAL_URL, 'http://127.0.0.1:1')
  assert.equal(environment.HYDRA_PUBLIC_URL, 'http://127.0.0.1:1/')
  assert.equal(environment.OUTLINE_INTEGRATION_KEY, 'isolated-outline-test-key')
  assert.equal(environment.OUTLINE_OIDC_CLIENT_SECRET, 'isolated-oidc-test-secret')
  assert.match(environment.SECRET_KEY, /^[a-f0-9]{64}$/)
  assert.notEqual(environment.SECRET_KEY, inherited.SECRET_KEY)
  assert.equal(environment.UTILS_SECRET, 'isolated-utils-test-secret')
  assert.equal(environment.TEMP, '/fixture/temp')
  assert.equal(environment.COREPACK_HOME, '/fixture/corepack')
  assert.equal(inherited.DATABASE_URL, 'existing-db')
})
