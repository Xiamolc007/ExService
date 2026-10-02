import { runAuthAccountCommand } from '@server/src/cli/auth-account.js'
import { assertCliEntry } from '@server/src/db/client.js'

assertCliEntry(import.meta.url)

try {
  await runAuthAccountCommand('disable', process.argv.slice(2))
  console.log('[auth:disable] account and existing sessions disabled')
} catch {
  console.error('[auth:disable] rejected; verify --user-id and the independent exre database')
  process.exitCode = 1
}
