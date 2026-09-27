import { existsSync } from 'node:fs'
import { assertAuthSchemaAvailable, AuthService } from '../auth/service.js'
import { DATABASE_PATH, openDatabase } from '../db/client.js'

export function createAppAuthService() {
  if (!existsSync(DATABASE_PATH)) {
    throw new Error(`本地 Mock 数据库不存在：${DATABASE_PATH}；请先运行 pnpm db:migrate。`)
  }
  const { sqlite } = openDatabase()
  try {
    assertAuthSchemaAvailable(sqlite)
    const authServices = new AuthService({
      sqlite,
    })
    return { authServices, close: () => sqlite.close() }
  } catch (error) {
    sqlite.close()
    throw error
  }
}
