import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Alert, AlertDescription, Button } from '@exre/exui'
import {
  AuthForm,
  type AuthFormHandle,
  type AuthFormErrors,
  type LoginDraft,
} from '@workspace/components'
import { api, unwrapEnvelope } from '@web/src/api/client'
import { ExAxiosError } from '@workspace/sdk/http/browser'
import { readToken, writeSsoSuccess, writeToken } from '@web/src/auth/storage'

export interface AuthFlowProps {
  initialMode?: 'login'
  initialEmail?: string
  presentation: 'modal' | 'page'
  ssoRequestId?: string
  onJoin?: () => void
  onFinished?: () => void
  onSessionCreated?: (token: string) => void
  footer?: ReactNode
  description?: ReactNode
}

export function AuthFlow({
  initialEmail = '',
  presentation,
  ssoRequestId,
  onJoin,
  onFinished,
  onSessionCreated,
  footer,
  description,
}: AuthFlowProps) {
  const navigate = useNavigate()
  const [step, setStep] = useState<'credentials' | 'captcha'>('credentials')
  const [flowBusy, setFlowBusy] = useState(ssoRequestId !== undefined)
  const [email, setEmail] = useState(initialEmail)
  const [ssoRetryError, setSsoRetryError] = useState<string | null>(null)
  const [captchaImage, setCaptchaImage] = useState<string | null>(null)
  const [captchaLoading, setCaptchaLoading] = useState(false)
  const challenge = useRef<{ challengeId: string } | null>(null)
  const generation = useRef(0)
  const authForm = useRef<AuthFormHandle>(null)
  const pendingDraft = useRef<LoginDraft | null>(null)

  useEffect(() => () => {
    generation.current += 1
    pendingDraft.current = null
  }, [])

  /** 拉取图片验证码挑战（进入 captcha 步 / 校验失败后换一张共用） */
  const refreshCaptcha = useCallback(async () => {
    setCaptchaLoading(true)
    try {
      const data = unwrapEnvelope<{ challengeId: string, imageBase64: string }>(
        await api.POST('/auth/captcha/challenges', { alert: false }))
      challenge.current = { challengeId: data.challengeId }
      setCaptchaImage(data.imageBase64)
      authForm.current?.clearServerErrors()
    } catch {
      challenge.current = null
      setCaptchaImage(null)
      authForm.current?.setServerErrors({ form: '验证码加载失败，请点击图片重试' })
    } finally {
      setCaptchaLoading(false)
    }
  }, [])

  function continueLogin(draft: LoginDraft) {
    pendingDraft.current = draft
    setEmail(draft.email)
    void refreshCaptcha()
    setStep('captcha')
  }

  async function submitCaptcha(answer: string) {
    const draft = pendingDraft.current
    if (draft === null) return
    await submitLogin(draft, answer)
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
    setSsoRetryError(null)
    setFlowBusy(true)
    try {
      await api.POST('/auth/sso/inspect', { body: { ssoRequestId: requestId }, alert: false })
      if (current !== generation.current) return
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
      await api.POST('/auth/sso/confirm', { body: { ssoRequestId: requestId }, alert: false })
      if (current !== generation.current) return
      finishSso(requestId)
    } catch (error) {
      if (current === generation.current) {
        if (error instanceof ExAxiosError && error.status === 401) {
          setFlowBusy(false)
          return
        }
        setSsoRetryError('暂时无法连接认证服务，请重试')
        setFlowBusy(false)
      }
    }
  }

  async function submitLogin(draft: LoginDraft, captchaAnswer?: string) {
    const current = ++generation.current
    authForm.current?.clearServerErrors()
    const captcha = challenge.current !== null && captchaAnswer !== undefined
      ? { challengeId: challenge.current.challengeId, answer: captchaAnswer } : undefined
    try {
      if (ssoRequestId !== undefined) {
        await api.POST('/auth/sso/login', {
          body: { ssoRequestId, email: draft.email, password: draft.password, ...(captcha ? { captcha } : {}) }, alert: false,
        })
        if (current !== generation.current) return
        finishSso(ssoRequestId)
        return
      }

      const result = await api.POST('/auth/login', {
        body: { email: draft.email, password: draft.password, ...(captcha ? { captcha } : {}) }, alert: false,
      })
      if (current !== generation.current) return
      // 后端统一响应 {msg, data}（与管理端方言一致），data.token 才是会话令牌
      const payload = result as unknown as { data: { token: string } }
      const newToken = payload.data.token
      let oldToken: string | null
      try {
        oldToken = readToken(window.localStorage)
      } catch {
        authForm.current?.setServerErrors({ form: '浏览器无法读取登录信息，请检查存储设置后重试' })
        return
      }
      if (oldToken !== null && oldToken !== newToken) {
        try {
          await api.POST('/auth/logout', {
            headers: { Authorization: `Bearer ${oldToken}` }, alert: false,
          })
          if (current !== generation.current) return
        } catch (error) {
          if (current !== generation.current) return
          if (!(error instanceof ExAxiosError && error.status === 401)) {
            authForm.current?.setServerErrors({ form: '旧账号退出失败，请重试登录' })
            return
          }
          // ExAxios may already have removed this expired token; never accept a replacement token.
          if (readToken(window.localStorage) === null) oldToken = null
        }
      }
      try {
        if (readToken(window.localStorage) !== oldToken) {
          authForm.current?.setServerErrors({ form: '登录状态已在其他页面更改，请重试' })
          return
        }
        writeToken(window.localStorage, newToken)
      } catch {
        authForm.current?.setServerErrors({ form: '浏览器无法保存登录信息，请检查存储设置后重试' })
        return
      }
      if (onSessionCreated) {
        onSessionCreated(newToken)
        return
      }
      onFinished?.()
      if (presentation === 'modal') {
        window.location.reload()
      } else {
        window.location.replace('/')
      }
    } catch (error) {
      if (current !== generation.current) return
      if (error instanceof ExAxiosError) {
        // 验证码错误(422): 挑战已一次性焚毁, 自动换新图让用户重输
        if (error.status === 422) void refreshCaptcha()
        authForm.current?.setServerErrors(mapError(error.status))
      } else authForm.current?.setServerErrors({ form: '暂时无法连接认证服务，请重试' })
    }
  }

  function join() {
    generation.current += 1
    pendingDraft.current = null
    if (onJoin) onJoin()
    else navigate('/communities/rifling-911')
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
      description={description}
      captchaImage={captchaImage ?? undefined}
      captchaLoading={captchaLoading}
      onRefreshCaptcha={() => void refreshCaptcha()}
      onContinueLogin={continueLogin}
      onCaptchaSubmit={submitCaptcha}
      onJoin={join}
      />
      {visibleFooter}
    </>
  )
}

/**
 * 后端（webman）错误体为 {msg} 而非契约信封，ExAxiosError 不携带响应体，
 * 因此按 HTTP 状态码映射登录表单文案。
 */
function mapError(status: number | undefined): AuthFormErrors {
  if (status === 400) return { form: '邮箱或密码错误' }
  if (status === 401) return { form: '登录状态已失效，请重新登录' }
  if (status === 403) return { form: '当前账户已经被禁用' }
  if (status === 422) return { captcha: '验证码不正确或已过期，已换新图请重输' }
  return { form: '请求失败，请稍后重试' }
}
