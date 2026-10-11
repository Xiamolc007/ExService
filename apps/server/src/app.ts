import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import type { AuthService } from './modules/auth/service.js'
import type { ProfileService } from './modules/profile/service.js'
import type { JoinService } from './domains/join/applications/service.js'
import type { InvitationService } from './domains/join/invitations/service.js'
import type { OidcService } from './modules/identity/oidc.js'
import type { StorageServices } from './modules/storage/factory.js'
import type { NotificationModule } from './modules/notifications/factory.js'
import authPlugin from './modules/auth/plugin.js'
import profilePlugin from './modules/profile/plugin.js'
import joinPlugin from './domains/join/plugin.js'
import identityPlugin from './modules/identity/plugin.js'
import storagePlugin from './modules/storage/plugin.js'
import notificationsPlugin from './modules/notifications/plugin.js'
import httpFoundation from './http/foundation.js'
import websiteApi from './http/plugin.js'

export { API_PREFIX, OPENAPI_PATH } from './contract/document.js'
export { serviceHandlers } from './http/service-handlers.js'

export interface CreateAppOptions {
  identityKeys?: { clients: Record<string, string>; bootstrapKey?: string };
  oidcServices?: OidcService;
  joinServices: JoinService;
  invitationServices: InvitationService;
  authServices: AuthService;
  profileServices: ProfileService;
  /**
   * 存储模块由 `server.ts` 在监听前按环境变量组装后注入；
   * 测试注入临时目录与 fake COS，不写开发数据。
   */
  storageServices: StorageServices;
  /**
   * 持久通知模块。`server.ts` 按环境变量组装后注入；测试注入隔离 schema。
   */
  notifications: NotificationModule;
  /**
   * 测试中保持静默；`server.ts` 开启日志，以便用 requestId 关联日志与响应。
   */
  logger?: FastifyServerOptions["logger"];
  /** 由监听入口显式限定可信代理；默认不信任客户端转发头。 */
  trustProxy?: FastifyServerOptions["trustProxy"];
  corsAllowedOrigins?: ReadonlySet<string>;
}

/** Create synchronously; service decorators and API routes become available after Fastify boot. */
export function createApp({
  authServices, profileServices, joinServices, invitationServices, storageServices, notifications,
  identityKeys, oidcServices, logger = false, trustProxy = false, corsAllowedOrigins = new Set(),
}: CreateAppOptions): FastifyInstance {
  const app = Fastify({
    logger, trustProxy, requestIdHeader: false, bodyLimit: 4 * 1024 * 1024,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  })
  app.register(authPlugin, { services: authServices })
  app.register(joinPlugin, { services: { joinServices, invitationServices } })
  app.register(profilePlugin, { services: profileServices })
  app.register(identityPlugin, { services: oidcServices })
  app.register(storagePlugin, { services: storageServices })
  app.register(notificationsPlugin, { services: notifications })
  app.register(httpFoundation, { origins: corsAllowedOrigins })
  app.register(websiteApi, { identityKeys })
  return app
}
