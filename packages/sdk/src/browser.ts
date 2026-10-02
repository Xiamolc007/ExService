import COS from 'cos-js-sdk-v5'
import { createStorageSdk, type CosPutInput, type CosTransport, type SdkOptions } from './shared.js'

/**
 * 浏览器 COS 传输：只用 PutObject，不调用 uploadFile 等可隐式分块的高级方法。
 */
const transport: CosTransport = {
  async putObject(input: CosPutInput): Promise<void> {
    // 每次调用独立实例：不使用全局可变凭证缓存，避免不同 key 并发串用。
    const client = new COS({
      getAuthorization(_options, callback) {
        callback({
          TmpSecretId: input.credentials.tmpSecretId,
          TmpSecretKey: input.credentials.tmpSecretKey,
          SecurityToken: input.credentials.securityToken,
          // 签名使用 STS 的起止时间，与服务端签发的窗口一致。
          StartTime: input.credentials.startTime,
          ExpiredTime: input.credentials.expiredTime,
        })
      },
    })
    await client.putObject({
      Bucket: input.bucket,
      Region: input.region,
      Key: input.key,
      // 浏览器侧用 Blob，不引入 Buffer。复制到新的 ArrayBuffer 以满足 BlobPart。
      Body: new Blob([new Uint8Array(input.bytes)], { type: input.contentType }),
      ContentType: input.contentType,
      ContentDisposition: 'attachment',
      CacheControl: 'no-store',
    })
  },
}

export function createSdk(options: SdkOptions) {
  return createStorageSdk(options, transport, false)
}

export type { SdkOptions, UploadOptions, UploadData, Medium, StorageSdk } from './shared.js'
export { StorageSdkError, type StorageSdkErrorCode } from './errors.js'
export { ExAxios, createExAxios, ExAxiosError, createApiClient } from './http/browser.js'
export type { ExAxiosOptions, ExAxiosInstance, ExAxiosRequestConfig, ExAxiosErrorKind, SessionExpiredContext, ApiClient, CreateApiClientOptions, paths, operations, components } from './http/browser.js'
