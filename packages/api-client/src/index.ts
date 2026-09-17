/**
 * 本包以**源码形式**导出（`exports` 直接指向 `src/index.ts`），由消费方的打包器
 * （Vite / tsx / tsc `moduleResolution: bundler`）编译，因此不需要额外的构建步骤。
 *
 * 它不是 Node 运行时包：本文件使用**无扩展名**的相对 import（`from './client'`），
 * Node ESM 不接受这种说明符，实测在 Node v22.22.1 上会报 `ERR_MODULE_NOT_FOUND`
 * （而不是因为 `.ts` 扩展名本身 —— Node ≥22.18 默认可以剥离类型并加载 `.ts`）。
 * 目前唯一的消费方是 `apps/web`（Vite 打包）；如果将来需要 Node 侧复用，必须为本包
 * 增加真正的构建产物与对应的 `exports` 条件，或统一改为显式扩展名的 import 约定。
 */

export { createApiClient } from './client'
export type { ApiClient, CreateApiClientOptions } from './client'

/**
 * 由 `pnpm api:generate` 从 `api/openapi.yaml` 生成的类型。
 * 前端与业务代码只应通过本包使用这些类型，不要在本仓库其他位置重新声明 DTO。
 */
export type { components, operations, paths } from './generated/schema'
