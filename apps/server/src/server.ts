import { createApp } from '@server/src/app.js'
import { parseAuthCodeHmacKey } from '@server/src/auth/crypto.js'
import { assertAuthSchemaAvailable } from '@server/src/auth/service.js'
import { createAuthServices } from '@server/src/auth/create-services.js'
import { openDatabase } from '@server/src/db/client.js'
import { assertDatabaseReady } from '@server/src/db/schema-check.js'
import { assertCommunitySchemaAvailable } from '@server/src/community/schema-check.js'
import { ProfileService, avatarDirectory, publicAvatarBaseUrl } from '@server/src/profile/service.js'
import { assertProfileSchemaAvailable } from '@server/src/profile/schema-check.js'
import { assertJoinSchemaAvailable } from '@server/src/join/schema-check.js'
import { createStorageModule } from '@server/src/modules/storage/factory.js'
import { parseStorageConfig, StorageConfigError } from '@server/src/modules/storage/config.js'
import { CorsConfigError, parseCorsAllowedOrigins } from '@server/src/http/cors.js'
import { HttpHydraAdmin, OidcService } from '@server/src/identity/oidc.js'
import { configuredIdentityOutboxWorker, startIdentityOutboxWorker } from '@server/src/identity/outbox.js'
import { IdentityConfigError, parseIdentityConfig } from '@server/src/identity/config.js'
import { assertDeploymentBinding } from '@server/src/identity/deployment-binding.js'

const PORT = Number(process.env.SERVER_PORT ?? '8080')
const HOST = process.env.SERVER_HOST ?? '127.0.0.1'
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('SERVER_PORT 必须是有效端口。')
}

try {
  // 配置在监听前解析为不可变对象；非法配置直接失败，不输出变量值或底层异常。
  const identity = parseIdentityConfig()
  assertDeploymentBinding(identity)
  const storageConfig = parseStorageConfig()
  const corsAllowedOrigins = parseCorsAllowedOrigins(process.env.SERVER_CORS_ALLOWED_ORIGINS)
  const storageServices = createStorageModule({ config: storageConfig })
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
      publicWebBaseUrl: identity.enabled ? identity.publicOrigin : process.env.SERVER_PUBLIC_WEB_BASE_URL,
      publicAvatarBaseUrl: publicAvatarBaseUrl(process.env.SERVER_PUBLIC_AVATAR_BASE_URL),
    })
    const profileServices = new ProfileService(db, avatarDirectory(process.env.SERVER_AVATAR_DIRECTORY),
      publicAvatarBaseUrl(process.env.SERVER_PUBLIC_AVATAR_BASE_URL))
    const oidcServices = identity.enabled ? new OidcService({ db, authServices,
      admin: new HttpHydraAdmin(identity.hydraAdminUrl),
      issuer: identity.issuer,
      flowKey: Buffer.from(identity.keys.flow, 'hex'),
      clients: identity.approvedClients,
    }) : undefined
    const app = createApp({ authServices, profileServices, joinServices, invitationServices, storageServices,
      identityKeys: identity.enabled ? { clients: { [identity.clientId]: identity.keys.outline }, bootstrapKey: identity.keys.bootstrap } : undefined,
      oidcServices, logger: true, corsAllowedOrigins })
    const outbox = identity.enabled ? configuredIdentityOutboxWorker(db, identity) : undefined
    let stopOutbox: (() => void) | undefined
    app.addHook('onClose', async () => { stopOutbox?.(); await db.close() })
    await app.listen({ port: PORT, host: HOST })
    if (outbox) stopOutbox = startIdentityOutboxWorker(outbox)
  } catch (error) {
    await db.close()
    throw error
  }
} catch (error) {
  // 存储配置错误自带安全文案：只列出缺失或非法的变量名分类，不含变量值。
  if (error instanceof IdentityConfigError) {
    console.error(`[server] ${error.message}; 请核对集成模式配置并显式运行 integration:configure。`)
  } else if (error instanceof StorageConfigError || error instanceof CorsConfigError) {
    console.error(`[server] 启动失败：${error.message}`)
  } else {
    console.error('[server] 启动失败。请确认 DATABASE_URL 指向 exre，已显式运行 pnpm db:migrate，并配置 AUTH_CODE_HMAC_KEY。')
  }
  process.exitCode = 1
}
