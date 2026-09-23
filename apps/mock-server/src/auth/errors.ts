export type AuthErrorCode =
  | 'BAD_REQUEST'
  | 'EMAIL_IN_USE'
  | 'INVALID_CREDENTIALS'
  | 'SESSION_INVALID'
  | 'REGISTRATION_NOT_FOUND'
  | 'REGISTRATION_CANCELLED'
  | 'REGISTRATION_COMPLETED'
  | 'REGISTRATION_EXPIRED'
  | 'CODE_INVALID'
  | 'CODE_EXPIRED'
  | 'CODE_ATTEMPTS_EXHAUSTED'
  | 'CODE_RESEND_TOO_SOON'
  | 'SSO_REQUEST_NOT_FOUND'
  | 'SSO_REQUEST_EXPIRED'
  | 'SSO_ACCOUNT_CONFLICT'
  | 'AUTH_BUSY'

const AUTH_ERROR_DETAILS: Record<AuthErrorCode, { statusCode: number; message: string }> = {
  BAD_REQUEST: { statusCode: 400, message: 'The request could not be processed.' },
  EMAIL_IN_USE: { statusCode: 409, message: '该邮箱已注册' },
  INVALID_CREDENTIALS: { statusCode: 401, message: '邮箱或密码错误' },
  SESSION_INVALID: { statusCode: 401, message: '登录状态已失效，请重新登录' },
  REGISTRATION_NOT_FOUND: { statusCode: 404, message: '注册请求不存在，请重新注册' },
  REGISTRATION_CANCELLED: { statusCode: 409, message: '注册请求已取消，请重新注册' },
  REGISTRATION_COMPLETED: { statusCode: 409, message: '注册已完成，请直接登录' },
  REGISTRATION_EXPIRED: { statusCode: 410, message: '注册请求已过期，请重新注册' },
  CODE_INVALID: { statusCode: 400, message: '验证码错误，请重新输入' },
  CODE_EXPIRED: { statusCode: 410, message: '验证码已过期，请重新获取' },
  CODE_ATTEMPTS_EXHAUSTED: { statusCode: 409, message: '验证码错误次数过多，请重新获取' },
  CODE_RESEND_TOO_SOON: { statusCode: 429, message: '验证码发送过于频繁，请稍后重试' },
  SSO_REQUEST_NOT_FOUND: { statusCode: 404, message: '登录请求不存在，请从发起应用重新登录' },
  SSO_REQUEST_EXPIRED: { statusCode: 410, message: '登录请求已过期，请从发起应用重新登录' },
  SSO_ACCOUNT_CONFLICT: { statusCode: 409, message: '该登录请求已由其他账号完成' },
  AUTH_BUSY: { statusCode: 503, message: '服务繁忙，请稍后重试' },
}

export class AuthError extends Error {
  readonly statusCode: number
  readonly publicMessage: string
  readonly retryAfterSeconds?: number

  constructor(readonly code: AuthErrorCode, options: { retryAfterSeconds?: number } = {}) {
    const details = AUTH_ERROR_DETAILS[code]
    super(code)
    this.name = 'AuthError'
    this.statusCode = details.statusCode
    this.publicMessage = details.message
    this.retryAfterSeconds = options.retryAfterSeconds
  }
}
