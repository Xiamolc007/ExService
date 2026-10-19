export type StorageSdkErrorCode =
  | 'INVALID_INPUT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'TIMEOUT'
  | 'UPSTREAM_FAILED'
  | 'UNAVAILABLE'
  | 'BUSY'
  | 'NETWORK'
  | 'UNKNOWN'
import { ExAxiosError } from './http/core.js'

const SERVER_CODE_TO_SDK_CODE: Record<string, StorageSdkErrorCode> = {
  STORAGE_INVALID_INPUT: 'INVALID_INPUT',
  STORAGE_TICKET_FORBIDDEN: 'FORBIDDEN',
  STORAGE_NOT_FOUND: 'NOT_FOUND',
  STORAGE_CONFLICT: 'CONFLICT',
  STORAGE_TOO_LARGE: 'TOO_LARGE',
  STORAGE_UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  STORAGE_TIMEOUT: 'TIMEOUT',
  STORAGE_UPSTREAM_FAILED: 'UPSTREAM_FAILED',
  STORAGE_UNAVAILABLE: 'UNAVAILABLE',
  STORAGE_BUSY: 'BUSY',
  SESSION_INVALID: 'UNAUTHORIZED',
  BAD_REQUEST: 'INVALID_INPUT',
  INTERNAL_ERROR: 'UNKNOWN',
  NOT_FOUND: 'NOT_FOUND',
}

/**
 * SDK 对外抛出的稳定错误。
 *
 * `message` 里绝不出现临时凭证、上传票据或完整 URL —— 服务端文案会被过滤后才拼进来。
 */
export class StorageSdkError extends Error {
  readonly code: StorageSdkErrorCode
  readonly status?: number
  readonly requestId?: string

  constructor(
    code: StorageSdkErrorCode,
    options: { status?: number; requestId?: string; detail?: string } = {},
  ) {
    super(
      options.detail === undefined
        ? `storage upload failed: ${code}`
        : `storage upload failed: ${code} (${options.detail})`,
    )
    this.name = 'StorageSdkError'
    this.code = code
    this.status = options.status
    this.requestId = options.requestId
  }
}

/** 去掉 URL 后再拼进 message：票据与签名地址不能被日志或 UI 带出去。 */
export function sanitizeDetail(message: unknown): string | undefined {
  if (typeof message !== 'string' || message === '') return undefined
  return message.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]').slice(0, 200)
}

export function serverCodeToSdkCode(code: unknown): StorageSdkErrorCode {
  return typeof code === 'string' && code in SERVER_CODE_TO_SDK_CODE
    ? SERVER_CODE_TO_SDK_CODE[code]!
    : 'UNKNOWN'
}

/**
 * 把服务端 envelope、HTTP 状态与网络异常统一成 StorageSdkError。
 * 云 SDK 的原始异常不直接作为展示文案。
 */
export function toStorageSdkError(input: {
  error?: unknown
  status?: number
  cause?: unknown
}): StorageSdkError {
  const { error, status, cause } = input
  if (cause instanceof ExAxiosError) {
    const code =
      cause.code === 'SESSION_INVALID'
        ? 'UNAUTHORIZED'
        : cause.code === 'TIMEOUT' || cause.code === 'CANCELLED'
          ? 'TIMEOUT'
          : cause.code === 'NETWORK_ERROR'
            ? 'NETWORK'
            : serverCodeToSdkCode(cause.code)
    return new StorageSdkError(code, {
      status: cause.status,
      requestId: cause.requestId,
      detail: sanitizeDetail(cause.kind === 'http' ? cause.message : undefined),
    })
  }
  const envelope =
    typeof error === 'object' && error !== null
      ? (error as { error?: { code?: unknown; message?: unknown; requestId?: unknown } }).error
      : undefined
  const code = serverCodeToSdkCode(envelope?.code)
  const requestId = typeof envelope?.requestId === 'string' ? envelope.requestId : undefined
  if (code !== 'UNKNOWN') {
    return new StorageSdkError(code, {
      status,
      requestId,
      detail: sanitizeDetail(envelope?.message),
    })
  }
  if (cause !== undefined) {
    const message = cause instanceof Error ? cause.message : String(cause)
    if (cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')) {
      return new StorageSdkError('TIMEOUT', { status })
    }
    return new StorageSdkError('NETWORK', { status, detail: sanitizeDetail(message) })
  }
  return new StorageSdkError('UNKNOWN', { status, requestId })
}
