import { dirname, resolve } from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyServerOptions,
} from "fastify";
import openapiGlue from "fastify-openapi-glue";
import multipart from "@fastify/multipart";
import { registerJoinTransport } from "@server/src/join/transport.js";
import { authenticateBearer } from "@server/src/auth/bearer.js";
import { registerStorageTransport } from "@server/src/modules/storage/transport.js";
import type { StorageServices } from "@server/src/modules/storage/factory.js";
import type { JoinService } from "@server/src/join/service.js";
import type { InvitationService } from "@server/src/invitations/service.js";
import * as joinHandlers from "@server/src/handlers/join.js";
import type { AuthService } from "@server/src/auth/service.js";
import type { ProfileService } from "@server/src/profile/service.js";
import { registerErrorHandlers } from "@server/src/errors.js";
import {
  createCaptchaChallenge,
  confirmSsoWithSession,
  getCurrentUser,
  inspectSsoRequest,
  login,
  loginForSso,
  logout,
} from "@server/src/handlers/auth.js";
import { getHealth } from "@server/src/handlers/health.js";
import {
  acceptOidcConsent,
  acceptOidcLogin,
  acceptOidcLogout,
  checkLinkedSession,
  inspectIdentityUser,
  inspectOidcRequest,
  revokeLinkedSession,
} from "@server/src/handlers/identity.js";
import { AuthError } from "@server/src/auth/errors.js";
import type { OidcService } from "@server/src/identity/oidc.js";
import {
  getAvatarImage,
  updateCurrentUser,
  uploadCurrentUserAvatar,
} from "@server/src/handlers/profile.js";
import {
  completeStorageUpload,
  getStoredFile,
  prepareStorageUpload,
  uploadStorageContent,
} from "@server/src/modules/storage/handlers.js";
import { registerHttpFoundation } from "@server/src/http/cors.js";
import { coerceQueryStringTypes } from "@server/src/http/query-coercion.js";
import type { NotificationModule } from "@server/src/modules/notifications/factory.js";
import {
  getNotification,
  getNotificationPreferences,
  getNotificationSummary,
  listNotifications,
  markNotificationsReadThrough,
  previewNotificationClear,
  clearNotificationsSnapshot,
  updateNotificationPreferences,
  updateNotificationState,
} from "@server/src/modules/notifications/handlers.js";

/**
 * Fastify 路由前缀。Contract 的 `servers[0].url` 只描述客户端 base URL，
 * `fastify-openapi-glue` 不会把它当作路由前缀，因此必须在此显式声明一次。
 * OpenAPI 中写作 `/health`，实际注册为 `/api/health`。
 */
export const API_PREFIX = "/api";

/**
 * 仓库根目录下唯一的 API Contract。
 * `src/app.ts` 与 `dist/app.js` 距包根目录同为一级，因此开发与构建产物都能解析到同一文件。
 */
export const OPENAPI_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../api/openapi.yaml",
);

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
  checkLinkedSession,
  revokeLinkedSession,
  inspectIdentityUser,
  inspectOidcRequest,
  acceptOidcLogin,
  acceptOidcConsent,
  acceptOidcLogout,
  prepareStorageUpload,
  uploadStorageContent,
  completeStorageUpload,
  getStoredFile,
  listNotifications,
  getNotificationSummary,
  getNotification,
  updateNotificationState,
  markNotificationsReadThrough,
  previewNotificationClear,
  clearNotificationsSnapshot,
  getNotificationPreferences,
  updateNotificationPreferences,
} as const;

/**
 * 创建可测试的 Fastify 实例。
 *
 * 路由、method、输入校验与响应 schema 全部来自 `api/openapi.yaml`：
 * 这里不手写任何 `app.get(...)`，也不从 Fastify schema 反向生成 OpenAPI。
 */
export function createApp({
  authServices,
  profileServices,
  joinServices,
  invitationServices,
  storageServices,
  notifications,
  identityKeys,
  oidcServices,
  logger = false,
  trustProxy = false,
  corsAllowedOrigins = new Set(),
}: CreateAppOptions): FastifyInstance {
  const app = Fastify({
    logger,
    trustProxy,
    requestIdHeader: false,
    bodyLimit: 4 * 1024 * 1024,
    ajv: {
      customOptions: {
        coerceTypes: false,
        removeAdditional: false,
      },
    },
  });

  registerHttpFoundation(app, {
    origins: corsAllowedOrigins,
    contractPath: OPENAPI_PATH,
  });

  app.decorate("joinServices", joinServices);
  app.decorate("invitationServices", invitationServices);
  app.decorate("authServices", authServices);
  app.decorate("profileServices", profileServices);
  app.decorate("storageServices", storageServices);
  app.decorate("notifications", notifications);
  app.decorate("oidcServices", oidcServices);
  app.decorateRequest("authSession", undefined);
  app.decorateRequest("identityClientId", undefined);
  registerErrorHandlers(app);
  app.register(multipart);
  registerJoinTransport(app);
  registerStorageTransport(app, { maxBytes: storageServices.config.maxBytes });

  app.addHook("preValidation", (request, _reply, done) => {
    if (
      typeof request.body === "object" &&
      request.body !== null &&
      !Array.isArray(request.body)
    ) {
      const body = request.body as Record<string, unknown>;
      if (typeof body.email === "string") {
        body.email = body.email.trim().toLowerCase();
      }
      if (typeof body.nickname === "string") {
        body.nickname = body.nickname.trim();
      }
    }
    done();
  });

  // 查询串在协议层是文本，Contract 声明成 integer/number/boolean 的查询参数必须先按声明的
  // 标量类型强制，否则 `?limit=20` 会被 `coerceTypes: false` 判成 400。类型只从 Glue 依
  // Contract 生成的 querystring schema 读取；请求体不属于这里，body 仍不强制。
  app.addHook("preValidation", (request, _reply, done) => {
    coerceQueryStringTypes(
      request.query as Record<string, unknown>,
      request.routeOptions?.schema?.querystring,
    );
    done();
  });

  app.register(openapiGlue, {
    specification: OPENAPI_PATH,
    prefix: API_PREFIX,
    serviceHandlers,
    securityHandlers: {
      // 与 storage transport 的认证前移共用同一个函数，不另建认证协议。
      // 上传场景中 Glue 在 preHandler 再复核一次，以处理上传期间会话过期或撤销。
      async bearerAuth(request: FastifyRequest) {
        await authenticateBearer(request, authServices);
      },
      async integrationKey(request: FastifyRequest) {
        const supplied = request.headers["x-integration-key"];
        if (typeof supplied !== "string")
          throw new AuthError("IDENTITY_UNAUTHORIZED");
        const client = Object.entries(identityKeys?.clients ?? {}).find(
          ([, key]) => safeKeyEqual(key, supplied),
        );
        if (!client) throw new AuthError("IDENTITY_UNAUTHORIZED");
        request.identityClientId = client[0];
      },
      async bootstrapKey(request: FastifyRequest) {
        const supplied = request.headers["x-bootstrap-key"];
        if (
          typeof supplied !== "string" ||
          !identityKeys?.bootstrapKey ||
          !safeKeyEqual(identityKeys.bootstrapKey, supplied)
        )
          throw new AuthError("IDENTITY_UNAUTHORIZED");
      },
    },
  });

  return app;
}

function safeKeyEqual(expected: string, actual: string): boolean {
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(expected), hash(actual));
}
