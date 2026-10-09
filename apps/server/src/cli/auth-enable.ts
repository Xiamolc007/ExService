import { runAuthAccountCommand } from '@server/src/cli/auth-account.js'
import { assertCliEntry } from '@server/src/db/client.js'

assertCliEntry(import.meta.url)

try {
  await runAuthAccountCommand('enable', process.argv.slice(2))
  console.log('[auth:enable] account enabled; sign in again to create a new session')
} catch {
  console.error('[auth:enable] rejected; verify --user-id and the independent exre database')
  process.exitCode = 1
}
