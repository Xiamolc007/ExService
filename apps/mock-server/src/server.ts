import { existsSync } from 'node:fs'
import { createApp } from './app.js'
import { parseAuthCodeHmacKey } from './auth/crypto.js'
import { assertAuthSchemaAvailable, AuthService } from './auth/service.js'
import { DATABASE_PATH, openDatabase } from './db/client.js'
import { ProfileService, publicAvatarBaseUrl } from './profile/service.js'
import { assertProfileSchemaAvailable } from './profile/schema-check.js'

const PORT = 8080
/** 只绑定回环地址：这是本地 Mock，不对局域网暴露。 */
const HOST = '127.0.0.1'

/**
 * 监听前的数据库前置检查。
 *
 * Mock Server 不会隐式创建或重置数据库：缺失时必须明确失败，并给出可执行的恢复命令。
 */
if (!existsSync(DATABASE_PATH)) {
  console.error(
    [
      `[mock-server] 本地 Mock 数据库不存在: ${DATABASE_PATH}`,
      '',
      '请先初始化数据库，然后重新启动：',
      '  pnpm db:migrate   # 创建/升级本地 Mock 数据库',
      '  pnpm db:reset     # 受控地删除并重建本地 Mock 数据库',
      '',
      'Mock Server 不会在启动时建表、生成 migration 或隐式重置数据。',
    ].join('\n'),
  )
  process.exitCode = 1
} else {
  try {
    const { sqlite } = openDatabase()
    assertAuthSchemaAvailable(sqlite)
    assertProfileSchemaAvailable(sqlite)
    const authServices = new AuthService({
      sqlite,
      codeHmacKey: parseAuthCodeHmacKey(process.env.AUTH_CODE_HMAC_KEY),
    })
    const profileServices = new ProfileService(sqlite, undefined,
      publicAvatarBaseUrl(process.env.MOCK_PUBLIC_AVATAR_BASE_URL))
    const app = createApp({ authServices, profileServices, logger: true })
    app.addHook('onClose', () => {
      sqlite.close()
    })
    await app.listen({ port: PORT, host: HOST })
  } catch (error) {
    console.error('[mock-server] 启动失败。请确认已运行 pnpm db:migrate，并配置 AUTH_CODE_HMAC_KEY。', error)
    process.exitCode = 1
  }
}
