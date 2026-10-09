import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configureLocal, defaults, loadLocal, LocalError } from './local-config.mjs'
import { bootstrapLocal, controlRequest, downLocal, initializeLocal, validUuid } from './local-dev.mjs'
import { devProcesses, assertModeAvailable, legacyCommand } from './legacy.mjs'
import { stopOwned } from './ownership.mjs'
export { devProcesses, assertModeAvailable }

/** Compatibility export accepts verified ownership records, never a PID or raw child. */
export const stopHostProcesses = stopOwned
export function parseCommandArguments(command, input) {
  const commands = ['configure', 'init', 'migrate', 'up', 'dev', 'bootstrap', 'down']
  if (!commands.includes(command)) throw new LocalError('INTEGRATION_COMMAND_INVALID')
  const args = [...input]
  if (args[0] === '--') args.shift()
  const parsed = { mode: undefined, adminUserId: undefined, ports: {} }, seen = new Set()
  const portFlags = Object.fromEntries(Object.keys(defaults).map(key => [`--${key.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`)}-port`, key]))
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1]
    if (seen.has(flag) || !value || value.startsWith('--')) throw new LocalError('INTEGRATION_ARGUMENTS_INVALID')
    seen.add(flag)
    if (flag === '--mode' && ['local', 'dev', 'full'].includes(value)) parsed.mode = value
    else if (flag === '--admin-user-id' && command === 'bootstrap' && validUuid(value)) parsed.adminUserId = value
    else if (portFlags[flag] && command === 'configure' && /^\d+$/.test(value) && Number(value) >= 1024 && Number(value) <= 65535)
      parsed.ports[portFlags[flag]] = Number(value)
    else throw new LocalError('INTEGRATION_ARGUMENTS_INVALID')
  }
  if (command === 'bootstrap' && !parsed.adminUserId) throw new LocalError('BOOTSTRAP_UUID_REQUIRED', 'pnpm infra bootstrap --admin-user-id <Website UUID>')
  if (Object.keys(parsed.ports).length && parsed.mode !== 'local') throw new LocalError('LOCAL_PORT_FLAGS_REQUIRE_MODE')
  if (parsed.mode === 'local' && ['dev', 'up'].includes(command)) throw new LocalError('LOCAL_START_COMMAND_INVALID', 'pnpm dev')
  return parsed
}
export async function main(command = process.argv[2], args = process.argv.slice(3)) {
  const options = parseCommandArguments(command, args)
  if (options.mode !== 'local') return legacyCommand(command, options.mode, options.adminUserId)
  if (command === 'configure') {
    // Configure also occupies the same cross-mode mutex; it never reads/migrates schemas.
    const { acquireLock } = await import('./ownership.mjs')
    const { refuseLegacyOwnership } = await import('./local-dev.mjs')
    const lock = acquireLock({ mode: 'local', fingerprint: 'local-configure', externalCheck: refuseLegacyOwnership })
    try { await configureLocal({ ports: options.ports }); console.log('LOCAL_CONFIGURED; next: pnpm db:migrate; pnpm infra init; explicit bootstrap; pnpm dev') }
    finally { lock.release() }
  } else if (command === 'init' || command === 'migrate') await initializeLocal(loadLocal(), { migrateOnly: command === 'migrate' })
  else if (command === 'bootstrap') {
    if (!await controlRequest('bootstrap', 'local', options.adminUserId)) await bootstrapLocal(loadLocal(), options.adminUserId)
  } else if (command === 'down') await downLocal()
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main() }
  catch (error) { console.error(error instanceof LocalError ? error.message : 'INTEGRATION_COMMAND_FAILED; next: verify configuration and explicit preparation'); process.exitCode = 1 }
}
