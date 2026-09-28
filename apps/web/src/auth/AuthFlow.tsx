import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Alert, AlertDescription, Button } from '@exre/exui'
import {
  AuthForm,
  type AuthFormHandle,
  type AuthFormErrors,
  type LoginDraft,
} from '@workspace/components'
import { api } from '@web/src/api/client'
import { readToken, removeMatchingToken, writeSsoSuccess, writeToken } from '@web/src/auth/storage'

export interface AuthFlowProps {
  initialMode?: 'login'
  initialEmail?: string
  presentation: 'modal' | 'page'
  ssoRequestId?: string
  onJoin?: () => void
  onFinished?: () => void
  footer?: ReactNode
}

export function AuthFlow({
  initialEmail = '',
  presentation,
  ssoRequestId,
  onJoin,
  onFinished,
  footer,
}: AuthFlowProps) {
  const navigate = useNavigate()
  const [step, setStep] = useState<'credentials' | 'captcha'>('credentials')
  const [flowBusy, setFlowBusy] = useState(ssoRequestId !== undefined)
  const [email, setEmail] = useState(initialEmail)
  const [fatalSsoError, setFatalSsoError] = useState<string | null>(null)
  const [ssoRetryError, setSsoRetryError] = useState<string | null>(null)
  const generation = useRef(0)
  const authForm = useRef<AuthFormHandle>(null)
  const pendingDraft = useRef<LoginDraft | null>(null)

  useEffect(() => () => {
    generation.current += 1
    pendingDraft.current = null
  }, [])

  function continueLogin(draft: LoginDraft) {
    pendingDraft.current = draft
    setEmail(draft.email)
    setStep('captcha')
  }

  async function submitCaptcha(_answer: string) {
    const draft = pendingDraft.current
    if (draft === null) return
    await submitLogin(draft)
  }

  useEffect(() => {
    if (ssoRequestId === undefined) {
      setFlowBusy(false)
      return
    }
    const current = ++generation.current
    void prepareSso(ssoRequestId, current)
  }, [ssoRequestId])

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

  function join() {
    generation.current += 1
    pendingDraft.current = null
    if (onJoin) onJoin()
    else navigate('/join/rifling-911')
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
      step={step}
      busy={flowBusy}
      initialEmail={email}
      onContinueLogin={continueLogin}
      onCaptchaSubmit={submitCaptcha}
      onJoin={join}
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
