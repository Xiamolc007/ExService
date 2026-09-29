import { createApiClient } from '@workspace/api-client'

/**
 * 前端唯一的 API base URL 来源。
 *
 * - 开发期缺省 `/api`，由 Vite 代理到本仓库唯一的 Server（`127.0.0.1:8080`）。
 * - `VITE_API_BASE_URL` 可覆盖浏览器请求的 API 前缀，业务调用仍通过共享 Client。
 *
 * 使用 `||` 而不是 `??`：设置为空字符串（例如 `VITE_API_BASE_URL=`）时同样回退到 `/api`，
 * 否则 `createApiClient` 会在模块加载阶段抛错，前端直接白屏。
 */
const baseUrl: string = import.meta.env.VITE_API_BASE_URL || '/api'

export const api = createApiClient({ baseUrl })
