import { createApp } from '@server/src/app.ts'
import { createTestAuth } from '@tests/helpers/auth.ts'

// Isolated process fixture: createTestAuth uses only in-memory SQLite and a temporary avatar directory.
const fixture = createTestAuth()
const app = createApp({ ...fixture })
process.once('SIGTERM', () => {
  app.server.closeAllConnections()
  void app.close().finally(() => { fixture.close(); process.exit(0) })
})
await app.listen({ host: '127.0.0.1', port: 0 })
const address = app.server.address()
if (address === null || typeof address === 'string') throw new Error('Missing isolated socket address')
process.send?.({ port: address.port, avatarDirectory: fixture.avatarDirectory })
