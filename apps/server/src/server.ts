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

const PORT = Number(process.env.SERVER_PORT ?? '8080')
const HOST = process.env.SERVER_HOST ?? '127.0.0.1'
const integrationEnabled = process.env.WEBSITE_INTEGRATION_ENABLED === 'true'

function identityKey(name: string): string {
  const value = process.env[name]
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${name} must be a 32-byte hexadecimal secret`)
  return value
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('SERVER_PORT 必须是有效端口。')
}

try {
  // 配置在监听前解析为不可变对象；非法配置直接失败，不输出变量值或底层异常。
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
      publicWebBaseUrl: process.env.SERVER_PUBLIC_WEB_BASE_URL,
      publicAvatarBaseUrl: publicAvatarBaseUrl(process.env.SERVER_PUBLIC_AVATAR_BASE_URL),
    })
    const profileServices = new ProfileService(db, avatarDirectory(process.env.SERVER_AVATAR_DIRECTORY),
      publicAvatarBaseUrl(process.env.SERVER_PUBLIC_AVATAR_BASE_URL))
    const outlineKey = integrationEnabled ? identityKey('OUTLINE_INTEGRATION_KEY') : undefined
    const bootstrapKey = integrationEnabled ? identityKey('IDENTITY_BOOTSTRAP_KEY') : undefined
    const oidcServices = integrationEnabled ? new OidcService({ db, authServices,
      admin: new HttpHydraAdmin(process.env.HYDRA_ADMIN_URL ?? ''),
      issuer: 'http://identity.exwebsite.test:8090/',
      flowKey: Buffer.from(identityKey('IDENTITY_FLOW_KEY'), 'hex'),
      clients: { 'ex-outline': { name: 'Docs', redirectUri: 'http://exwebsite.test:8090/docs/auth/oidc.callback',
        scopes: ['openid', 'profile', 'email'] },
        'ex-oidc-probe': { name: 'OIDC Probe', redirectUri: 'http://127.0.0.1:18765/callback',
          scopes: ['openid', 'profile', 'email'] } },
    }) : undefined
    const app = createApp({ authServices, profileServices, joinServices, invitationServices, storageServices,
      identityKeys: outlineKey ? { clients: { 'ex-outline': outlineKey }, bootstrapKey } : undefined,
      oidcServices, logger: true, corsAllowedOrigins })
    const outbox = integrationEnabled ? configuredIdentityOutboxWorker(db) : undefined
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
  if (error instanceof StorageConfigError || error instanceof CorsConfigError) {
    console.error(`[server] 启动失败：${error.message}`)
  } else {
    console.error('[server] 启动失败。请确认 DATABASE_URL 指向 exre，已显式运行 pnpm db:migrate，并配置 AUTH_CODE_HMAC_KEY。')
  }
  process.exitCode = 1
}
