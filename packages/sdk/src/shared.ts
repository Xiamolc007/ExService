import { createApiClient } from '@workspace/api-client'
import { StorageSdkError, toStorageSdkError } from './errors.js'
import { createHttpCore } from './http/core.js'

/** 每次本站请求与每次 COS PutObject 的截止时间。 */
export const REQUEST_TIMEOUT_MS = 120_000

export type Medium = 'file' | 'cos'
export type UploadData = Blob | Uint8Array

export interface UploadOptions {
  medium?: Medium
  contentType?: string
}

export interface SdkOptions {
  /**
   * 本站 API 根地址。浏览器允许 `/api` 这类相对地址，Node 要求绝对 HTTP(S) 地址。
   */
  baseUrl: string
  /** 每次本站请求前调用；SDK 不持久化、不刷新、不提供登录界面。 */
  getAccessToken: () => string | Promise<string>
}

export interface CosCredentials {
  tmpSecretId: string
  tmpSecretKey: string
  securityToken: string
  startTime: number
  expiredTime: number
}

export interface CosPutInput {
  bucket: string
  region: string
  key: string
  /** 已归一化的字节，单次调用快照。 */
  bytes: Uint8Array
  contentType: string
  credentials: CosCredentials
}

/** 环境相关的 COS 传输实现；浏览器与 Node 各自提供，共享逻辑不感知具体 SDK。 */
export interface CosTransport {
  putObject(input: CosPutInput): Promise<void>
}

export const FALLBACK_CONTENT_TYPE = 'application/octet-stream'
const CONTENT_TYPE_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+\/[A-Za-z0-9!#$%&'*+.^_`|~-]+$/

export function resolveContentType(explicit: string | undefined, blobType: string | undefined): string {
  if (explicit !== undefined) return explicit
  if (typeof blobType === 'string' && blobType !== '' && blobType.length <= 127 && CONTENT_TYPE_PATTERN.test(blobType)) {
    return blobType
  }
  return FALLBACK_CONTENT_TYPE
}

/** 与服务端一致的只读视图复制：不上传底层 ArrayBuffer 的额外字节。 */
async function toBytes(data: UploadData): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return new Uint8Array(data).slice()
  if (typeof data === 'object' && data !== null && typeof (data as Blob).arrayBuffer === 'function') {
    return new Uint8Array(await (data as Blob).arrayBuffer())
  }
  throw new StorageSdkError('INVALID_INPUT', { detail: 'unsupported binary input' })
}

function assertBaseUrl(baseUrl: string, requireAbsolute: boolean): void {
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    throw new StorageSdkError('INVALID_INPUT', { detail: 'baseUrl is required' })
  }
  if (!requireAbsolute) return
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new StorageSdkError('INVALID_INPUT', { detail: 'node entry requires an absolute http(s) baseUrl' })
  }
}

async function apiRequest<T>(pending: Promise<T>): Promise<T> {
  try {
    return await pending
  } catch (cause) {
    throw toStorageSdkError({ cause })
  }
}

/**
 * 上传协调：归一化输入 → prepare → 按返回 medium 固定本次介质
 * → file multipart，或 COS PutObject 后 complete → 只返回 URL。
 *
 * 每次调用独立持有 COS 临时凭证，不使用全局可变凭证缓存，避免不同 key 并发串用。
 */
export function createStorageSdk(options: SdkOptions, transport: CosTransport, requireAbsoluteBaseUrl: boolean, requestPolicy: { timeoutMs?: number; signal?: AbortSignal } = {}) {
  assertBaseUrl(options.baseUrl, requireAbsoluteBaseUrl)
  const http = createHttpCore({ environment: requireAbsoluteBaseUrl ? 'node' : 'browser', origin: requireAbsoluteBaseUrl ? undefined : location.origin }, {
    baseUrl: options.baseUrl, websiteBaseUrl: options.baseUrl, alert: false, onSessionExpired: () => {},
  })
  const client = createApiClient({ baseUrl: options.baseUrl, transport: request => http(request) })

  async function headers(): Promise<Record<string, string>> {
    const token = await options.getAccessToken()
    if (typeof token !== 'string' || token === '') {
      throw new StorageSdkError('UNAUTHORIZED', { detail: 'getAccessToken returned no token' })
    }
    return { authorization: `Bearer ${token}` }
  }

  async function upload(key: string, data: UploadData, uploadOptions: UploadOptions = {}): Promise<string> {
    if (typeof key !== 'string' || key.length === 0) {
      throw new StorageSdkError('INVALID_INPUT', { detail: 'key is required' })
    }
    const bytes = await toBytes(data)
    const contentType = resolveContentType(uploadOptions.contentType, data instanceof Uint8Array ? undefined : data.type)

    const prepared = await apiRequest(client.POST('/storage/uploads/prepare', {
      timeout: requestPolicy.timeoutMs ?? REQUEST_TIMEOUT_MS, signal: requestPolicy.signal, alert: false,
      headers: await headers(),
      body: {
        key,
        size: bytes.byteLength,
        contentType,
        ...(uploadOptions.medium === undefined ? {} : { medium: uploadOptions.medium }),
      },
    }))
    const plan = prepared

    // prepare 的 maxBytes 只是客户端预检，服务器仍是最终校验者。
    if (bytes.byteLength > plan.maxBytes) throw new StorageSdkError('TOO_LARGE')

    if (plan.medium === 'cos') {
      try {
        await transport.putObject({
          bucket: plan.bucket,
          region: plan.region,
          key: plan.key,
          bytes,
          contentType,
          credentials: plan.credentials,
        })
      } catch (cause) {
        throw toStorageSdkError({ cause })
      }
      const completed = await apiRequest(client.POST('/storage/uploads/complete', {
        timeout: requestPolicy.timeoutMs ?? REQUEST_TIMEOUT_MS, signal: requestPolicy.signal, alert: false,
        headers: await headers(),
        body: { key: plan.key, uploadTicket: plan.uploadTicket },
      }))
      return completed.url
    }

    // FormData 序列化：boundary 由运行时生成，不手写 Content-Type。
    // `new Uint8Array(bytes)` 复制到新的 ArrayBuffer，同时也满足 BlobPart 的类型要求。
    const form = new FormData()
    form.append('key', key)
    form.append('medium', 'file')
    form.append('contentType', contentType)
    form.append('data', new Blob([new Uint8Array(bytes)], { type: contentType }), key.split('/').pop() ?? key)

    const uploaded = await apiRequest(client.POST('/storage/uploads', {
      timeout: requestPolicy.timeoutMs ?? REQUEST_TIMEOUT_MS, signal: requestPolicy.signal, alert: false,
      headers: await headers(),
      body: form,
    }))
    return uploaded.url
  }

  return { storage: { upload } }
}

export type StorageSdk = ReturnType<typeof createStorageSdk>
