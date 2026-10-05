import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LocalError, toolchain } from '../docs-integration/local-config.mjs'
import { runOwned } from '../docs-integration/ownership.mjs'
import { runLocal, initializeLocal, bootstrapLocal, validUuid } from '../docs-integration/local-dev.mjs'
import { readRuntimeConfiguration, validateReceipt, operatingEnvironment } from './configuration.mjs'
import { configureRuntime, importExisting } from './configure.mjs'
import { startDependencies, stopDependencies } from './dependencies.mjs'
import { testSelection } from '../docs-integration/test-outline.mjs'

export function parseRuntimeArguments(input) {
  const args = [...input]; if (args[0] === '--') args.shift()
  const command = args.shift()
  if (!['start', 'dev', 'stop', 'infra'].includes(command)) throw new LocalError('RUNTIME_COMMAND_INVALID', 'pnpm start | dev | stop | infra <action>')
  if (args[0] === '--') args.shift()
  if (command !== 'infra') {
    if (args.length) throw new LocalError('RUNTIME_ARGUMENTS_INVALID')
    return { command }
  }
  const action = args.shift(); if (args[0] === '--') args.shift()
  if (!['configure', 'init', 'migrate', 'bootstrap', 'test'].includes(action)) throw new LocalError('RUNTIME_ACTION_INVALID')
  if (action === 'test') {
    try { testSelection(args) } catch { throw new LocalError('RUNTIME_TEST_SELECTION_REQUIRED', 'pnpm infra test <server/plugins test file> <literal test case name>') }
    return { command, action, testArgs: args }
  }
  if (action === 'configure' && args.length === 1 && args[0] === '--import-existing') return { command, action, importExisting: true }
  if (action === 'bootstrap') {
    if (args.length !== 2 || args[0] !== '--admin-user-id' || !validUuid(args[1])) throw new LocalError('BOOTSTRAP_UUID_REQUIRED', 'pnpm infra bootstrap --admin-user-id <Website-UUID>')
    return { command, action, adminUserId: args[1] }
  }
  if (args.length) throw new LocalError('RUNTIME_ARGUMENTS_INVALID')
  return { command, action }
}
export async function main(input = process.argv.slice(2)) {
  const options = parseRuntimeArguments(input)
  if (options.action === 'test') return runOwned({ name: 'outline-test', command: process.execPath,
    args: [fileURLToPath(new URL('../docs-integration/test-outline.mjs', import.meta.url)), ...options.testArgs],
    environment: { ...operatingEnvironment(), ...Object.fromEntries(['INTEGRATION_NODE_BIN', 'INTEGRATION_COREPACK_JS'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])) }, cwd: resolve('.') })
  if (options.action === 'configure') {
    await (options.importExisting ? importExisting() : configureRuntime())
    console.log('RUNTIME_CONFIGURED; next: explicit pnpm infra init when needed; pnpm start; pnpm dev'); return
  }
  const state = readRuntimeConfiguration({ profile: 'local' }); validateReceipt(state)
  if (options.command === 'start') await startDependencies(state)
  else if (options.command === 'stop') await stopDependencies(state)
  else if (options.command === 'dev') await runLocal({ state, tools: toolchain({ workspace: state.workspace, inherited: state.values }), independentDependencies: true })
  else if (['init', 'migrate'].includes(options.action)) await initializeLocal(state, { migrateOnly: options.action === 'migrate' })
  else if (options.action === 'bootstrap') await bootstrapLocal(state, options.adminUserId, { preserveDependencies: true })
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main() }
  catch (error) { console.error(error instanceof LocalError ? error.message : 'RUNTIME_COMMAND_FAILED; check explicit configuration and preparation'); process.exitCode = 1 }
}
