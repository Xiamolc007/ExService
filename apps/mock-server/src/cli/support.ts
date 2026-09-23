import { existsSync } from 'node:fs'
import { parseAuthCodeHmacKey } from '../auth/crypto.js'
import { assertAuthSchemaAvailable, AuthService } from '../auth/service.js'
import { DATABASE_PATH, openDatabase } from '../db/client.js'
import { assertProfileSchemaAvailable } from '../profile/schema-check.js'

export function createAppAuthService() {
  if (!existsSync(DATABASE_PATH)) {
    throw new Error(`本地 Mock 数据库不存在：${DATABASE_PATH}；请先运行 pnpm db:migrate。`)
  }
  const { sqlite } = openDatabase()
  try {
    assertAuthSchemaAvailable(sqlite)
    assertProfileSchemaAvailable(sqlite)
    const authServices = new AuthService({
      sqlite,
      codeHmacKey: parseAuthCodeHmacKey(process.env.AUTH_CODE_HMAC_KEY),
    })
    return { authServices, close: () => sqlite.close() }
  } catch (error) {
    sqlite.close()
    throw error
  }
}
