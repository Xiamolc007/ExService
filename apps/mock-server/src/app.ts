import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyInstance } from 'fastify'
import openapiGlue from 'fastify-openapi-glue'
import { registerErrorHandlers } from './errors.js'
import { getHealth } from './handlers/health.js'

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
  /**
   * 测试中保持静默；`server.ts` 开启日志，以便用 requestId 关联日志与响应。
   */
  logger?: boolean
}

/**
 * `operationId` -> handler 的显式映射。新增 operation 时必须在这里登记。
 *
 * 导出这个映射是为了让 Contract Test 能直接校验 handler 的**原始返回值**：
 * Fastify 会用 Contract 的 response schema 序列化响应，未声明的字段会被静默丢弃，
 * 且 `const` 声明会被强制写入（handler 返回 `{status:'down'}` 时线上仍是 `{"status":"ok"}`）。
 * 因此只断言 HTTP 响应体无法发现 handler 回归，必须同时校验这里注册的 handler。
 */
export const serviceHandlers = { getHealth } as const

/**
 * 创建可测试的 Fastify 实例。
 *
 * 路由、method、输入校验与响应 schema 全部来自 `api/openapi.yaml`：
 * 这里不手写任何 `app.get(...)`，也不从 Fastify schema 反向生成 OpenAPI。
 */
export function createApp({ logger = false }: CreateAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger })

  registerErrorHandlers(app)

  app.register(openapiGlue, {
    specification: OPENAPI_PATH,
    prefix: API_PREFIX,
    serviceHandlers,
  })

  return app
}
