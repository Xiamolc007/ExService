import createClient from 'openapi-fetch'
import type { paths } from '@api-client/src/generated/schema'

export interface CreateApiClientOptions {
  /**
   * API base URL。开发期通常是 `/api`，由 Vite 代理到本仓库的 Server。
   * 调整部署地址时由应用配置该值，业务调用点不变。
   */
  baseUrl: string
}

/**
 * 基于 `api/openapi.yaml` 生成的 `paths` 类型创建类型安全客户端。
 *
 * 该函数不定义任何 endpoint —— endpoint 只存在于 Contract 中。
 */
export function createApiClient({ baseUrl }: CreateApiClientOptions) {
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    throw new Error('createApiClient requires a non-empty baseUrl.')
  }

  return createClient<paths>({ baseUrl })
}

export type ApiClient = ReturnType<typeof createApiClient>
