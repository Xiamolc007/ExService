import createClient from 'openapi-fetch'
import type { paths } from './generated/schema'

export interface CreateApiClientOptions {
  /**
   * API base URL。开发期通常是 `/api`（由 Vite 代理到 Mock Server）；
   * 接入 PHP 时改为 PHP 的 API 前缀，业务调用点不变。
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
