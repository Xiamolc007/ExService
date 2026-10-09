import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import * as command from './command.mjs'
import { identityAlive, processIdentity, spawnOwned, stopOwned } from './ownership.mjs'

const values = {
  WEBSITE_SERVER_UPSTREAM: 'host.docker.internal:19180',
  WEBSITE_WEB_UPSTREAM: 'host.docker.internal:19181',
  OUTLINE_BACKEND_UPSTREAM: 'host.docker.internal:14100',
  OUTLINE_STATIC_UPSTREAM: 'host.docker.internal:14101',
  EXUI_SOURCE_DIR: 'D:/fixtures/exui',
  EXRE_PASSWORD: 'fixture-exre', OUTLINE_PASSWORD: 'fixture-outline',
  AUTH_CODE_HMAC_KEY: 'fixture-hmac', OUTLINE_SECRET_KEY: 'fixture-secret',
  OUTLINE_UTILS_SECRET: 'fixture-utils',
}
const options = { root: 'D:/fixtures/website', localRoot: 'D:/fixtures/website/.local/docs-integration',
  environment: { PATH: 'fixture-path' }, node: 'D:/fixtures/node/node.exe' }

test('host apps listen on the same configured ports used by the gateway', () => {
  const processes = command.devProcesses?.(values, options)
  assert.deepEqual(processes?.filter(item => item.name !== 'exui').map(item => [
    item.name, item.environment.SERVER_PORT ?? item.environment.INTEGRATION_WEB_PORT ?? item.environment.PORT,
  ]), [['server', '19180'], ['web', '19181'], ['outline', '14100']])
  assert.equal(processes.find(item => item.name === 'web').environment.INTEGRATION_SERVER_PORT, '19180')
  assert.equal(processes.find(item => item.name === 'outline').environment.INTEGRATION_OUTLINE_VITE_PORT, '14101')
})

test('development uses installed ExUI without starting a source watcher', () => {
  const processes = command.devProcesses?.(values, options)
  const watcher = processes?.find(item => item.name === 'exui')
  assert.equal(watcher, undefined)
})

test('legacy preserves direct TLS backend while gateway and outbox share the explicitly persisted HTTP transport', () => {
  const processes = command.devProcesses({ ...values, OUTLINE_DIRECT_UPSTREAM: 'host.docker.internal:14100',
    OUTLINE_BACKEND_UPSTREAM: 'host.docker.internal:14102', OUTLINE_HTTP_PORT: '14102' }, options)
  const outline = processes.find(item => item.name === 'outline'), server = processes.find(item => item.name === 'server')
  assert.equal(outline.environment.PORT, '14100')
  assert.equal(outline.environment.OUTLINE_DEV_HTTP_PORT, '14102')
  assert.equal(server.environment.OUTLINE_INTERNAL_URL, 'http://127.0.0.1:14102/')
})

test('invalid upstreams fail before any host process starts', () => {
  for (const upstream of ['other-host:18180', 'host.docker.internal:0', 'host.docker.internal:65536', 'host.docker.internal:abc']) {
    assert.throws(() => command.devProcesses?.({ ...values, WEBSITE_SERVER_UPSTREAM: upstream }, options), /端口|upstream/)
  }
})

test('a live host supervisor prevents both duplicate dev starts and mode switches', () => {
  for (const next of ['dev', 'full']) {
    assert.throws(() => command.assertModeAvailable?.({ mode: 'dev' }, next, '', true), /运行/)
  }
})

test('a stale mode record does not prevent starting another mode', () => {
  assert.doesNotThrow(() => command.assertModeAvailable?.({ mode: 'dev' }, 'full', '', false))
  assert.throws(() => command.assertModeAvailable?.({ mode: 'full' }, 'dev', 'outline\nserver', false), /运行/)
})

test('stopping owned host apps also stops their descendant processes', async () => {
  const messages = [], owned = await spawnOwned({ name: 'compatibility-fixture', command: process.execPath,
    args: [resolve('tests/dev/fixture-process.mjs'), 'descendant'], cwd: resolve('.'), environment: process.env },
  { onLog: (_name, line) => messages.push(line) })
  try {
    for (let count = 0; count < 100 && !messages.some(value => value.startsWith('DESCENDANT:')); count++) await delay(50)
    const descendant = processIdentity(Number(messages.find(value => value.startsWith('DESCENDANT:'))?.split(':')[1]))
    await command.stopHostProcesses([owned])
    assert.equal(identityAlive(descendant), false)
  } finally { await stopOwned([owned]) }
})
