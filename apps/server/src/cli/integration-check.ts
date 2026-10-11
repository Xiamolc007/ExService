import { assertCliEntry, openDatabase } from '@server/src/db/client.js'
import { IdentityConfigError } from '@server/src/modules/identity/config.js'
import { assertWebsiteIntegrationReady, IdentityReadinessError,
  parseIntegrationCheckArguments, validateWebsiteIntegrationPreflight } from '@server/src/integration-readiness.js'

assertCliEntry(import.meta.url)

try {
  const adminUserId = parseIntegrationCheckArguments(process.argv.slice(2))
  validateWebsiteIntegrationPreflight()
  let db
  try { db = await openDatabase() } catch { throw new IdentityReadinessError('INTEGRATION_CHECK_DATABASE_INVALID') }
  try { await assertWebsiteIntegrationReady(db, adminUserId) }
  finally { await db.close() }
  console.log('[integration:check] INTEGRATION_CHECK_READY')
} catch (error) {
  const code = error instanceof IdentityConfigError ? error.message :
    error instanceof IdentityReadinessError ? error.code : 'INTEGRATION_CHECK_FAILED'
  console.error(`[integration:check] ${code}`)
  process.exitCode = 1
}
