// Test-only executable mounted into the actual Website image and dist directory.
import { openDatabase } from './dist/db/client.js'
import { parseIdentityConfig } from './dist/identity/config.js'
import { configuredIdentityOutboxWorker } from './dist/identity/outbox.js'
let db
try {
  db = await openDatabase()
  const config = parseIdentityConfig(), errors = []
  const worker = configuredIdentityOutboxWorker(db, config, () => 1000, code => errors.push(code))
  const claimed = await worker.drainOne()
  console.log(JSON.stringify({ claimed, errors, authorizationClients: Object.keys(config.approvedClients), mode: config.mode }))
} catch { console.error('OUTBOX_NETWORK_FIXTURE_FAILED'); process.exitCode = 1 }
finally { await db?.close() }
