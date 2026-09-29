import { createApp } from '@server/src/app.js'
import { parseAuthCodeHmacKey } from '@server/src/auth/crypto.js'
import { assertAuthSchemaAvailable } from '@server/src/auth/service.js'
import { createAuthServices } from '@server/src/auth/create-services.js'
import { openDatabase } from '@server/src/db/client.js'
import { assertDatabaseReady } from '@server/src/db/schema-check.js'
import { assertCommunitySchemaAvailable } from '@server/src/community/schema-check.js'
import { ProfileService, publicAvatarBaseUrl } from '@server/src/profile/service.js'
import { assertProfileSchemaAvailable } from '@server/src/profile/schema-check.js'
import { assertJoinSchemaAvailable } from '@server/src/join/schema-check.js'

const PORT = 8080
const HOST = '127.0.0.1'

try {
  const db = await openDatabase()
  try {
    await assertDatabaseReady(db)
    await assertAuthSchemaAvailable(db)
    await assertProfileSchemaAvailable(db)
    await assertCommunitySchemaAvailable(db)
    await assertJoinSchemaAvailable(db)
    const { authServices, invitationServices, joinServices } = createAuthServices({
      db,
      codeHmacKey: parseAuthCodeHmacKey(process.env.AUTH_CODE_HMAC_KEY),
      publicWebBaseUrl: process.env.SERVER_PUBLIC_WEB_BASE_URL,
    })
    const profileServices = new ProfileService(db, undefined,
      publicAvatarBaseUrl(process.env.SERVER_PUBLIC_AVATAR_BASE_URL))
    const app = createApp({ authServices, profileServices, joinServices, invitationServices, logger: true })
    app.addHook('onClose', () => db.close())
    await app.listen({ port: PORT, host: HOST })
  } catch (error) {
    await db.close()
    throw error
  }
} catch {
  console.error('[server] 启动失败。请确认 DATABASE_URL 指向 exre，已显式运行 pnpm db:migrate，并配置 AUTH_CODE_HMAC_KEY。')
  process.exitCode = 1
}
