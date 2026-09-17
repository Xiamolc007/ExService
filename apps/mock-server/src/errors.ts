import type { FastifyError, FastifyInstance } from 'fastify'

/**
 * Contract 只把 `ErrorEnvelope.error.code` 约束为 string；下列取值是实现侧的约定。
 * 新增取值不需要改 Contract，但必须集中在本文件构造 envelope，并保持 Contract Test 通过。
 */
export type ErrorCode = 'BAD_REQUEST' | 'INTERNAL_ERROR' | 'NOT_FOUND'

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
 * 它可能包含 SQL、SQLite 绝对路径、堆栈或原始异常内容。
 * Fastify request ID 同时用于响应中的 `requestId` 与日志关联。
 */
export function registerErrorHandlers(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    void reply
      .status(404)
      .send(createErrorEnvelope('NOT_FOUND', 'The requested route is not part of the API contract.', request.id))
  })

  // Fastify 5 的 setErrorHandler 默认把错误参数推断为 unknown，因此显式声明 FastifyError。
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const reported = typeof error.statusCode === 'number' ? error.statusCode : 500
    const statusCode = reported >= 400 && reported < 600 ? reported : 500

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'request failed')
    } else {
      request.log.warn({ err: error }, 'request rejected')
    }

    const message = resolvePublicMessage(statusCode, error)

    void reply.status(statusCode).send(createErrorEnvelope(codeForStatus(statusCode), message, request.id))
  })
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
