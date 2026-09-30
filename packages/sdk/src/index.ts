/**
 * 包根的公开类型面。
 *
 * 这里刻意不导出运行时实现：`browser` 与 `node` 条件各自指向对应产物，
 * 二者的公开类型一致，因此 types 只需描述这一份契约。
 */
import type { SdkOptions, StorageSdk } from './shared.js'

export type { SdkOptions, UploadOptions, UploadData, Medium, StorageSdk } from './shared.js'
export type { StorageSdkErrorCode } from './errors.js'
export { StorageSdkError } from './errors.js'

/**
 * 创建 SDK。`browser` 条件解析到浏览器产物，`node` 条件解析到 Node 产物。
 */
export declare function createSdk(options: SdkOptions): StorageSdk
