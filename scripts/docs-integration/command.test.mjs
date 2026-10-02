import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import * as command from './command.mjs'

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

test('development starts the linked ExUI watcher rather than watching a copied build context', () => {
  const processes = command.devProcesses?.(values, options)
  const watcher = processes?.find(item => item.name === 'exui')
  assert.deepEqual(watcher && { cwd: watcher.cwd, args: watcher.args },
    { cwd: 'D:/fixtures/exui', args: ['pnpm', 'exec', 'node', join(options.root, 'scripts', 'docs-integration', 'watch-exui.mjs')] })
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
  const child = spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    console.log(descendant.pid);
    setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'ignore'], detached: process.platform !== 'win32' })
  const descendantPid = await new Promise((resolve, reject) => {
    child.stdout.once('data', data => resolve(Number(data.toString().trim())))
    child.once('error', reject)
  })
  const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
  try {
    command.stopHostProcesses?.([child])
    for (let count = 0; count < 20 && alive(descendantPid); count++) await delay(50)
    assert.equal(alive(descendantPid), false, 'owned watcher/app descendants must not survive integration:down')
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      else { try { process.kill(-child.pid, 'SIGKILL') } catch {} }
    }
    if (alive(descendantPid)) { try { process.kill(descendantPid, 'SIGKILL') } catch {} }
  }
})
