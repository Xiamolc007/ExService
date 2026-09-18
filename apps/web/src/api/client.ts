import { createApiClient } from '@workspace/api-client'

/**
 * 前端唯一的 API base URL 来源。
 *
 * - 开发期缺省 `/api`，由 Vite 代理到 Mock Server（`127.0.0.1:8080`）。
 * - 接入 PHP 时，在部署环境把 `VITE_API_BASE_URL` 指向 PHP 的 API 前缀，
 *   业务调用点与共享 Client 都不需要改动。
 *
 * 使用 `||` 而不是 `??`：设置为空字符串（例如 `VITE_API_BASE_URL=`）时同样回退到 `/api`，
 * 否则 `createApiClient` 会在模块加载阶段抛错，前端直接白屏。
 */
const baseUrl: string = import.meta.env.VITE_API_BASE_URL || '/api'

export const api = createApiClient({ baseUrl })
