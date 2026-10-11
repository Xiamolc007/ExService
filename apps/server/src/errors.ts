import type { FastifyError, FastifyInstance } from 'fastify'
import { AuthError, type AuthErrorCode } from '@server/src/modules/auth/errors.js'
import type { StorageErrorCode } from '@server/src/modules/storage/errors.js'

/**
 * Contract 只把 `ErrorEnvelope.error.code` 约束为 string；下列取值是实现侧的约定。
 * 新增取值不需要改 Contract，但必须集中在本文件构造 envelope，并保持 Contract Test 通过。
 */
export type ErrorCode = 'BAD_REQUEST' | 'INTERNAL_ERROR' | 'NOT_FOUND' | AuthErrorCode | StorageErrorCode

/**
 * 应用错误对外契约：带 code / statusCode / publicMessage 的错误都按固定文案输出，
 * 其余异常的 `error.message` 一律不回显。
 *
 * 这里用结构化判定而不是 `instanceof`，因此新增错误类型不需要把模块 import 进来。
 */
interface PublicError {
  readonly code: ErrorCode
  readonly statusCode: number
  readonly publicMessage: string
  readonly retryAfterSeconds?: number
}

function asPublicError(value: unknown): PublicError | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  if (typeof candidate.code !== 'string') return undefined
  if (typeof candidate.statusCode !== 'number') return undefined
  if (typeof candidate.publicMessage !== 'string') return undefined
  return candidate as unknown as PublicError
}

export function createErrorEnvelope(code: ErrorCode, message: string, requestId: string) {
  return { error: { code, message, requestId } }
}

function codeForStatus(statusCode: number): ErrorCode {
  if (statusCode === 404) {
    return 'NOT_FOUND'
  }
  return statusCode >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'
}

/**
 * 统一错误输出：未声明路径与所有未捕获错误都返回 Contract 中的 ErrorEnvelope。
 *
 * 对外消息只允许两种来源：
 * 1. Fastify 依据 Contract schema 生成的校验错误（`error.validation`），对调用方有价值且不含内部状态；
 * 2. 固定文案。
 *
 * 其他异常（包括应用代码主动抛出的 4xx）一律不回显 `error.message`：
 * 它可能包含 SQL、数据库连接信息、堆栈或原始异常内容。
 * Fastify request ID 同时用于响应中的 `requestId` 与日志关联。
 */
export function registerErrorHandlers(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    void reply
      .header('Cache-Control', 'no-store')
      .status(404)
      .send(createErrorEnvelope('NOT_FOUND', 'The requested route is not part of the API contract.', request.id))
  })

  // Fastify 5 的 setErrorHandler 默认把错误参数推断为 unknown，因此显式声明 FastifyError。
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const publicError = findPublicError(error)
    const reported = publicError?.statusCode ?? (typeof error.statusCode === 'number' ? error.statusCode : 500)
    const statusCode = reported >= 400 && reported < 600 ? reported : 500

    const message = publicError?.publicMessage ?? resolvePublicMessage(statusCode, error)
    const code = publicError?.code ?? codeForStatus(statusCode)

    // Exceptions from hashing, delivery or PostgreSQL can contain submitted secrets.
    // Request ID remains attached by Fastify; log only the safe classification.
    if (statusCode >= 500) {
      request.log.error({ code, statusCode }, 'request failed')
    } else {
      request.log.warn({ code, statusCode }, 'request rejected')
    }

    void reply.header('Cache-Control', 'no-store')
    if (publicError?.retryAfterSeconds !== undefined) {
      void reply.header('Retry-After', String(publicError.retryAfterSeconds))
    }
    void reply.status(statusCode).send(createErrorEnvelope(code, message, request.id))
  })
}

function findPublicError(error: unknown): PublicError | undefined {
  if (error instanceof AuthError) {
    return error
  }
  const direct = asPublicError(error)
  if (direct !== undefined) {
    return direct
  }
  if (typeof error === 'object' && error !== null && 'errors' in error) {
    const nested = (error as { errors?: unknown }).errors
    if (Array.isArray(nested)) {
      for (const candidate of nested) {
        const publicError = findPublicError(candidate)
        if (publicError !== undefined) {
          return publicError
        }
      }
    }
  }
  return undefined
}

function resolvePublicMessage(statusCode: number, error: FastifyError): string {
  if (statusCode >= 500) {
    return 'An unexpected error occurred.'
  }

  // 只有 Fastify 自己的校验错误可以回显：它由 Contract schema 产生，不携带内部实现细节。
  if (error.validation !== undefined) {
    return error.message
  }

  return 'The request could not be processed.'
}
