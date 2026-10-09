/**
 * 本包以**源码形式**导出（`exports` 直接指向 `src/index.ts`），由消费方的打包器
 * （Vite / tsx / tsc `moduleResolution: bundler`）编译，因此不需要额外的构建步骤。
 *
 * 它不是 Node 运行时包：包内的 `@api-client` 源码别名由 Vite 解析，Node ESM
 * 不会直接识别。若要在 Node 侧复用，必须提供可运行的构建产物与 `exports` 条件。
 */

export { createApiClient } from '@api-client/src/client'
export type { ApiClient, CreateApiClientOptions } from '@api-client/src/client'
export type { ApiTransport, HttpTransportRequest } from '@api-client/src/transport'

/**
 * 由 `pnpm api:generate` 从 `api/openapi.yaml` 生成的类型。
 * 前端与业务代码只应通过本包使用这些类型，不要在本仓库其他位置重新声明 DTO。
 */
export type { components, operations, paths } from '@api-client/src/generated/schema'
