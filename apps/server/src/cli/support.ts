import { assertAuthSchemaAvailable, AuthService } from '@server/src/modules/auth/service.js'
import { openDatabase, type DatabaseOptions } from '@server/src/db/client.js'

export async function createAppAuthService(options: DatabaseOptions = {}) {
  const db = await openDatabase(options)
  try {
    await assertAuthSchemaAvailable(db)
    return { authServices: new AuthService({ db }), close: () => db.close() }
  } catch (error) {
    await db.close()
    throw error
  }
}
