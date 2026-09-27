export type AuthErrorCode =
  | 'BAD_REQUEST'
  | 'EMAIL_IN_USE'
  | 'INVALID_CREDENTIALS'
  | 'SESSION_INVALID'
  | 'CODE_RESEND_TOO_SOON'
  | 'SSO_REQUEST_NOT_FOUND'
  | 'SSO_REQUEST_EXPIRED'
  | 'SSO_ACCOUNT_CONFLICT'
  | 'JOIN_APPLICATION_NOT_FOUND'
  | 'INVITATION_APPLICATION_NOT_FOUND'
  | 'INVITATION_NOT_ELIGIBLE'
  | 'JOIN_STATE_CONFLICT'
  | 'INVITATION_CODE_INVALID'
  | 'INVITATION_CODE_LOCKED'
  | 'COMPLETION_GRANT_INVALID'
  | 'JOIN_RATE_LIMITED'
  | 'AUTH_BUSY'

const AUTH_ERROR_DETAILS: Record<AuthErrorCode, { statusCode: number; message: string }> = {
  BAD_REQUEST: { statusCode: 400, message: 'The request could not be processed.' },
  EMAIL_IN_USE: { statusCode: 409, message: '该邮箱已注册' },
  INVALID_CREDENTIALS: { statusCode: 401, message: '邮箱或密码错误' },
  SESSION_INVALID: { statusCode: 401, message: '登录状态已失效，请重新登录' },
  CODE_RESEND_TOO_SOON: { statusCode: 429, message: '验证码发送过于频繁，请稍后重试' },
  SSO_REQUEST_NOT_FOUND: { statusCode: 404, message: '登录请求不存在，请从发起应用重新登录' },
  SSO_REQUEST_EXPIRED: { statusCode: 410, message: '登录请求已过期，请从发起应用重新登录' },
  SSO_ACCOUNT_CONFLICT: { statusCode: 409, message: '该登录请求已由其他账号完成' },
  JOIN_APPLICATION_NOT_FOUND: { statusCode: 404, message: '申请不存在' },
  INVITATION_APPLICATION_NOT_FOUND: { statusCode: 404, message: '未找到该邮箱的申请，请先申请加入' },
  INVITATION_NOT_ELIGIBLE: { statusCode: 409, message: '该邮箱暂不符合注册条件，请确认申请已通过且邀请仍有效' },
  JOIN_STATE_CONFLICT: { statusCode: 409, message: '申请审核状态已发生变化，请刷新后重试' },
  INVITATION_CODE_INVALID: { statusCode: 400, message: '验证码无效或已过期，请重新获取' },
  INVITATION_CODE_LOCKED: { statusCode: 429, message: '验证码错误次数过多，请稍后重试' },
  COMPLETION_GRANT_INVALID: { statusCode: 401, message: '完善凭证无效或已过期，请重新获取验证码' },
  JOIN_RATE_LIMITED: { statusCode: 429, message: '请求过于频繁，请稍后重试' },
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
