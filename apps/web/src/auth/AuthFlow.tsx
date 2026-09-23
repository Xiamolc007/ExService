import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Alert, AlertDescription, Button } from '@exre/exui'
import {
  AuthForm,
  type AuthFormHandle,
  type AuthFormErrors,
  type AuthMode,
  type LoginDraft,
  type RegistrationDraft,
} from '@workspace/components'
import { api } from '../api/client'
import { readToken, removeMatchingToken, writeSsoSuccess, writeToken } from './storage'

export interface AuthFlowProps {
  initialMode: AuthMode
  initialEmail?: string
  presentation: 'modal' | 'page'
  ssoRequestId?: string
  onModeChange?: (mode: AuthMode) => void
  onFinished?: () => void
  footer?: ReactNode
}

export function AuthFlow({
  initialMode,
  initialEmail = '',
  presentation,
  ssoRequestId,
  onModeChange,
  onFinished,
  footer,
}: AuthFlowProps) {
  const navigate = useNavigate()
  const [mode, setMode] = useState(initialMode)
  const [step, setStep] = useState<'credentials' | 'captcha' | 'verify' | 'registered'>('credentials')
  const [flowBusy, setFlowBusy] = useState(ssoRequestId !== undefined)
  const [email, setEmail] = useState(initialEmail)
  const [registrationId, setRegistrationId] = useState<string | null>(null)
  const [serverTime, setServerTime] = useState(0)
  const [resendAvailableAt, setResendAvailableAt] = useState(0)
  const [challengeReceivedAt, setChallengeReceivedAt] = useState(0)
  const [clock, setClock] = useState(Date.now())
  const [canRetryVerification, setCanRetryVerification] = useState(false)
  const [fatalSsoError, setFatalSsoError] = useState<string | null>(null)
  const [ssoRetryError, setSsoRetryError] = useState<string | null>(null)
  const generation = useRef(0)
  const authForm = useRef<AuthFormHandle>(null)
  const successTimer = useRef<number | null>(null)
  const pendingDraft = useRef<LoginDraft | RegistrationDraft | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setMode(initialMode)
  }, [initialMode])

  useEffect(() => () => {
    generation.current += 1
    pendingDraft.current = null
    if (successTimer.current !== null) window.clearTimeout(successTimer.current)
  }, [])

  function continueLogin(draft: LoginDraft) {
    pendingDraft.current = draft
    setEmail(draft.email)
    setStep('captcha')
  }

  function continueRegistration(draft: RegistrationDraft) {
    pendingDraft.current = draft
    setEmail(draft.email)
    setStep('captcha')
  }

  async function submitCaptcha(_answer: string) {
    const draft = pendingDraft.current
    if (draft === null) return
    if (mode === 'register' && 'nickname' in draft) await submitRegistration(draft)
    else await submitLogin(draft)
  }

  useEffect(() => {
    if (ssoRequestId === undefined) {
      setFlowBusy(false)
      return
    }
    const current = ++generation.current
    void prepareSso(ssoRequestId, current)
  }, [ssoRequestId])

  const resendRemainingSeconds = useMemo(() => {
    if (resendAvailableAt <= serverTime) {
      return 0
    }
    const elapsed = Math.max(0, clock - challengeReceivedAt)
    return Math.max(0, Math.ceil((resendAvailableAt - serverTime - elapsed) / 1000))
  }, [challengeReceivedAt, clock, resendAvailableAt, serverTime])

  async function prepareSso(requestId: string, current: number) {
    setFatalSsoError(null)
    setSsoRetryError(null)
    setFlowBusy(true)
    try {
      const inspected = await api.POST('/auth/sso/inspect', { body: { ssoRequestId: requestId } })
      if (current !== generation.current) return
      if (inspected.error !== undefined) {
        if (isFatalSsoCode(inspected.error.error.code)) {
          setFatalSsoError(inspected.error.error.message)
        } else {
          setSsoRetryError(inspected.error.error.message)
        }
        setFlowBusy(false)
        return
      }
      let token: string | null
      try {
        token = readToken(window.localStorage)
      } catch {
        authForm.current?.setServerErrors({ form: '浏览器无法读取登录信息，请使用邮箱和密码继续' })
        setFlowBusy(false)
        return
      }
      if (token === null) {
        setFlowBusy(false)
        return
      }
      const confirmed = await api.POST('/auth/sso/confirm', {
        body: { ssoRequestId: requestId },
        headers: { Authorization: `Bearer ${token}` },
      })
      if (current !== generation.current) return
      if (confirmed.data !== undefined) {
        finishSso(requestId)
        return
      }
      if (confirmed.error.error.code === 'SESSION_INVALID') {
        removeMatchingToken(window.localStorage, token)
        setFlowBusy(false)
        return
      }
      if (isFatalSsoCode(confirmed.error.error.code)) {
        setFatalSsoError(confirmed.error.error.message)
      } else {
        setSsoRetryError(confirmed.error.error.message)
      }
      setFlowBusy(false)
    } catch {
      if (current === generation.current) {
        setSsoRetryError('暂时无法连接认证服务，请重试')
        setFlowBusy(false)
      }
    }
  }

  async function submitLogin(draft: LoginDraft) {
    const current = ++generation.current
    authForm.current?.clearServerErrors()
    try {
      if (ssoRequestId !== undefined) {
        const result = await api.POST('/auth/sso/login', {
          body: { ssoRequestId, email: draft.email, password: draft.password },
        })
        if (current !== generation.current) return
        if (result.error !== undefined) {
          if (isFatalSsoCode(result.error.error.code)) {
            setFatalSsoError(result.error.error.message)
            return
          }
          authForm.current?.setServerErrors(mapError(result.error.error.code, result.error.error.message))
          return
        }
        finishSso(ssoRequestId)
        return
      }

      const result = await api.POST('/auth/login', {
        body: { email: draft.email, password: draft.password },
      })
      if (current !== generation.current) return
      if (result.error !== undefined) {
        authForm.current?.setServerErrors(mapError(result.error.error.code, result.error.error.message))
        return
      }
      try {
        writeToken(window.localStorage, result.data.token)
      } catch {
        authForm.current?.setServerErrors({ form: '浏览器无法保存登录信息，请检查存储设置后重试' })
        return
      }
      onFinished?.()
      if (presentation === 'modal') {
        window.location.reload()
      } else {
        window.location.replace('/')
      }
    } catch {
      if (current === generation.current) authForm.current?.setServerErrors({ form: '暂时无法连接认证服务，请重试' })
    }
  }

  async function submitRegistration(draft: RegistrationDraft) {
    const current = ++generation.current
    authForm.current?.clearServerErrors()
    try {
      const result = await api.POST('/auth/registrations', {
        body: { email: draft.email, nickname: draft.nickname, password: draft.password },
      })
      if (current !== generation.current) return
      if (result.error !== undefined) {
        authForm.current?.setServerErrors(mapError(result.error.error.code, result.error.error.message))
        return
      }
      setEmail(result.data.email)
      setRegistrationId(result.data.registrationId)
      setServerTime(result.data.serverTime)
      setResendAvailableAt(result.data.resendAvailableAt)
      setChallengeReceivedAt(Date.now())
      pendingDraft.current = null
      setStep('verify')
    } catch {
      if (current === generation.current) authForm.current?.setServerErrors({ form: '暂时无法连接认证服务，请重试' })
    }
  }

  async function verify(code: string) {
    if (registrationId === null) return
    const current = ++generation.current
    authForm.current?.clearServerErrors()
    setCanRetryVerification(false)
    try {
      const result = await api.POST('/auth/registrations/verify', {
        body: { registrationId, code },
      })
      if (current !== generation.current) return
      if (result.error !== undefined) {
        const mapped = mapError(result.error.error.code, result.error.error.message)
        authForm.current?.setServerErrors(mapped)
        setCanRetryVerification(result.error.error.code === 'CODE_INVALID' || result.error.error.code === 'INTERNAL_ERROR')
        return
      }
      setEmail(result.data.email)
      setStep('registered')
      successTimer.current = window.setTimeout(() => {
        if (current === generation.current) finishRegistration(result.data.email)
      }, 1500)
    } catch {
      if (current === generation.current) {
        authForm.current?.setServerErrors({ form: '暂时无法连接认证服务，请重试' })
        setCanRetryVerification(true)
      }
    }
  }

  async function resend() {
    if (registrationId === null) return false
    const current = ++generation.current
    setFlowBusy(true)
    authForm.current?.clearServerErrors()
    try {
      const result = await api.POST('/auth/registrations/resend', { body: { registrationId } })
      if (current !== generation.current) return false
      if (result.error !== undefined) {
        authForm.current?.setServerErrors(mapError(result.error.error.code, result.error.error.message))
        const retryAfter = Number(result.response.headers.get('Retry-After'))
        if (Number.isSafeInteger(retryAfter) && retryAfter > 0) {
          const now = Date.now()
          setServerTime(now)
          setResendAvailableAt(now + retryAfter * 1000)
          setChallengeReceivedAt(now)
        }
        return false
      }
      setServerTime(result.data.serverTime)
      setResendAvailableAt(result.data.resendAvailableAt)
      setChallengeReceivedAt(Date.now())
      setCanRetryVerification(false)
      return true
    } catch {
      if (current === generation.current) authForm.current?.setServerErrors({ form: '暂时无法连接认证服务，请重试' })
      return false
    } finally {
      if (current === generation.current) setFlowBusy(false)
    }
  }

  function switchMode(nextMode: AuthMode, currentEmail: string) {
    generation.current += 1
    pendingDraft.current = null
    if (successTimer.current !== null) {
      window.clearTimeout(successTimer.current)
      successTimer.current = null
    }
    setMode(nextMode)
    setStep('credentials')
    setEmail(currentEmail)
    setRegistrationId(null)
    authForm.current?.clearServerErrors()
    onModeChange?.(nextMode)
    if (presentation === 'page') {
      navigate(`${nextMode === 'login' ? '/login' : '/register'}${ssoRequestId ? `?ssoRequestId=${encodeURIComponent(ssoRequestId)}` : ''}`, {
        replace: true,
        state: { email: currentEmail },
      })
    }
  }

  function finishRegistration(completedEmail: string) {
    pendingDraft.current = null
    if (successTimer.current !== null) {
      window.clearTimeout(successTimer.current)
      successTimer.current = null
    }
    if (presentation === 'page') {
      navigate(`/login${ssoRequestId ? `?ssoRequestId=${encodeURIComponent(ssoRequestId)}` : ''}`, {
        replace: true,
        state: { email: completedEmail },
      })
      return
    }
    setMode('login')
    setStep('credentials')
    setRegistrationId(null)
    authForm.current?.clearServerErrors()
    onModeChange?.('login')
  }

  function finishSso(requestId: string) {
    try {
      writeSsoSuccess(window.sessionStorage, { ssoRequestId: requestId, confirmedAt: Date.now() })
    } catch {
      authForm.current?.setServerErrors({ form: '浏览器无法保存本次确认结果，请重试' })
      setFlowBusy(false)
      return
    }
    onFinished?.()
    window.location.replace('/sso/success')
  }

  const visibleFooter = step === 'captcha' ? null : footer

  if (fatalSsoError !== null) {
    return <><Alert variant="destructive" role="alert"><AlertDescription>{fatalSsoError}</AlertDescription></Alert>{visibleFooter}</>
  }

  if (ssoRetryError !== null && ssoRequestId !== undefined) {
    return (
      <>
        <Alert variant="destructive" role="alert">
          <AlertDescription>{ssoRetryError}</AlertDescription>
          <Button type="button" variant="outline" onClick={() => void prepareSso(ssoRequestId, ++generation.current)}>
            重试
          </Button>
        </Alert>
        {visibleFooter}
      </>
    )
  }

  return (
    <>
      <AuthForm
      ref={authForm}
      mode={mode}
      step={step}
      busy={flowBusy}
      initialEmail={email}
      targetEmail={email}
      resendRemainingSeconds={resendRemainingSeconds}
      canRetryVerification={canRetryVerification}
      onContinueLogin={continueLogin}
      onContinueRegistration={continueRegistration}
      onCaptchaSubmit={submitCaptcha}
      onVerify={verify}
      onResend={resend}
      onSwitchMode={switchMode}
      onContinueToLogin={() => finishRegistration(email)}
      />
      {visibleFooter}
    </>
  )
}

function mapError(code: string, message: string): AuthFormErrors {
  if (code === 'EMAIL_IN_USE') return { email: message }
  if (code === 'INVALID_CREDENTIALS') return { form: '邮箱或密码错误' }
  if (code.startsWith('CODE_')) return { code: message }
  return { form: message || '请求失败，请稍后重试' }
}

function isFatalSsoCode(code: string): boolean {
  return code === 'SSO_REQUEST_NOT_FOUND' || code === 'SSO_REQUEST_EXPIRED' || code === 'SSO_ACCOUNT_CONFLICT'
}
