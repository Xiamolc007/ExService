import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyServerOptions } from 'fastify'
import openapiGlue from 'fastify-openapi-glue'
import multipart from '@fastify/multipart'
import { registerJoinTransport } from '@server/src/join/transport.js'
import { authenticateBearer } from '@server/src/auth/bearer.js'
import { registerStorageTransport } from '@server/src/modules/storage/transport.js'
import type { StorageServices } from '@server/src/modules/storage/factory.js'
import type { JoinService } from '@server/src/join/service.js'
import type { InvitationService } from '@server/src/invitations/service.js'
import * as joinHandlers from '@server/src/handlers/join.js'
import type { AuthService } from '@server/src/auth/service.js'
import type { ProfileService } from '@server/src/profile/service.js'
import { registerErrorHandlers } from '@server/src/errors.js'
import {
  createCaptchaChallenge,
  confirmSsoWithSession,
  getCurrentUser,
  inspectSsoRequest,
  login,
  loginForSso,
  logout,
} from '@server/src/handlers/auth.js'
import { getHealth } from '@server/src/handlers/health.js'
import { getAvatarImage, updateCurrentUser, uploadCurrentUserAvatar } from '@server/src/handlers/profile.js'
import {
  completeStorageUpload,
  getStoredFile,
  prepareStorageUpload,
  uploadStorageContent,
} from '@server/src/modules/storage/handlers.js'

/**
 * Fastify 路由前缀。Contract 的 `servers[0].url` 只描述客户端 base URL，
 * `fastify-openapi-glue` 不会把它当作路由前缀，因此必须在此显式声明一次。
 * OpenAPI 中写作 `/health`，实际注册为 `/api/health`。
 */
export const API_PREFIX = '/api'

/**
 * 仓库根目录下唯一的 API Contract。
 * `src/app.ts` 与 `dist/app.js` 距包根目录同为一级，因此开发与构建产物都能解析到同一文件。
 */
export const OPENAPI_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../api/openapi.yaml')

export interface CreateAppOptions {
  joinServices: JoinService
  invitationServices: InvitationService
  authServices: AuthService
  profileServices: ProfileService
  /**
   * 存储模块由 `server.ts` 在监听前按环境变量组装后注入；
   * 测试注入临时目录与 fake COS，不写开发数据。
   */
  storageServices: StorageServices
  /**
   * 测试中保持静默；`server.ts` 开启日志，以便用 requestId 关联日志与响应。
   */
  logger?: FastifyServerOptions['logger']
}

/**
 * `operationId` -> handler 的显式映射。新增 operation 时必须在这里登记。
 *
 * 导出这个映射是为了让 Contract Test 能直接校验 handler 的**原始返回值**：
 * Fastify 会用 Contract 的 response schema 序列化响应，未声明的字段会被静默丢弃，
 * 且 `const` 声明会被强制写入（handler 返回 `{status:'down'}` 时线上仍是 `{"status":"ok"}`）。
 * 因此只断言 HTTP 响应体无法发现 handler 回归，必须同时校验这里注册的 handler。
 */
export const serviceHandlers = {
  ...joinHandlers,
  getHealth,
  createCaptchaChallenge,
  login,
  getCurrentUser,
  updateCurrentUser,
  uploadCurrentUserAvatar,
  getAvatarImage,
  logout,
  inspectSsoRequest,
  loginForSso,
  confirmSsoWithSession,
  prepareStorageUpload,
  uploadStorageContent,
  completeStorageUpload,
  getStoredFile,
} as const

/**
 * 创建可测试的 Fastify 实例。
 *
 * 路由、method、输入校验与响应 schema 全部来自 `api/openapi.yaml`：
 * 这里不手写任何 `app.get(...)`，也不从 Fastify schema 反向生成 OpenAPI。
 */
export function createApp({ authServices, profileServices, joinServices, invitationServices, storageServices, logger = false }: CreateAppOptions): FastifyInstance {
  const app = Fastify({
    logger,
    bodyLimit: 4 * 1024 * 1024,
    ajv: {
      customOptions: {
        coerceTypes: false,
        removeAdditional: false,
      },
    },
  })

  app.decorate('joinServices', joinServices)
  app.decorate('invitationServices', invitationServices)
  app.decorate('authServices', authServices)
  app.decorate('profileServices', profileServices)
  app.decorate('storageServices', storageServices)
  app.decorateRequest('authSession', undefined)
  registerErrorHandlers(app)
  app.register(multipart)
  registerJoinTransport(app)
  registerStorageTransport(app, { maxBytes: storageServices.config.maxBytes })

  app.addHook('preValidation', (request, _reply, done) => {
    if (typeof request.body === 'object' && request.body !== null && !Array.isArray(request.body)) {
      const body = request.body as Record<string, unknown>
      if (typeof body.email === 'string') {
        body.email = body.email.trim().toLowerCase()
      }
      if (typeof body.nickname === 'string') {
        body.nickname = body.nickname.trim()
      }
    }
    done()
  })

  app.register(openapiGlue, {
    specification: OPENAPI_PATH,
    prefix: API_PREFIX,
    serviceHandlers,
    securityHandlers: {
      // 与 storage transport 的认证前移共用同一个函数，不另建认证协议。
      // 上传场景中 Glue 在 preHandler 再复核一次，以处理上传期间会话过期或撤销。
      async bearerAuth(request: FastifyRequest) {
        await authenticateBearer(request, authServices)
      },
    },
  })

  return app
}
