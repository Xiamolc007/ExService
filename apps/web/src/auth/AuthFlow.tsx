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
import { ExAxiosError } from '@workspace/sdk/http/browser'
import { readToken, writeSsoSuccess } from '@web/src/auth/storage'
import type { components } from '@workspace/api-client'
import { installBrowserSession } from './session-install'
import { CfxAuthorization } from '@web/src/registration/CfxAuthorization'
import { PublicRegistrationFlow } from '@web/src/registration/PublicRegistrationFlow'

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
  const [fatalSsoError, setFatalSsoError] = useState<string | null>(null)
  const [ssoRetryError, setSsoRetryError] = useState<string | null>(null)
  const [cfxBusy,setCfxBusy] = useState(false)
  const [cfxNotice,setCfxNotice] = useState<string|null>(null)
  const [cfxGrant,setCfxGrant] = useState<Extract<components['schemas']['CfxSignInResult'],{kind:'registration-required'}>|null>(null)
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
        if (error instanceof ExAxiosError && error.code === 'SESSION_INVALID') {
          setFlowBusy(false)
          return
        }
        if (error instanceof ExAxiosError && isFatalSsoCode(error.code)) setFatalSsoError(error.message)
        else setSsoRetryError('暂时无法连接认证服务，请重试')
        setFlowBusy(false)
      }
    }
  }

  async function submitLogin(draft: LoginDraft) {
    const current = ++generation.current
    authForm.current?.clearServerErrors()
    try {
      if (ssoRequestId !== undefined) {
        await api.POST('/auth/sso/login', {
          body: { ssoRequestId, email: draft.email, password: draft.password }, alert: false,
        })
        if (current !== generation.current) return
        finishSso(ssoRequestId)
        return
      }

      const result = await api.POST('/auth/login', {
        body: { email: draft.email, password: draft.password }, alert: false,
      })
      if (current !== generation.current) return
      await acceptSession(result.token,current)
    } catch (error) {
      if (current !== generation.current) return
      if (error instanceof ExAxiosError) {
        if (isFatalSsoCode(error.code)) setFatalSsoError(error.message)
        else authForm.current?.setServerErrors(mapError(error.code, error.message))
      } else authForm.current?.setServerErrors({ form: '暂时无法连接认证服务，请重试' })
    }
  }

  async function acceptSession(token:string,current:number,signal?:AbortSignal) {
    const installed=await installBrowserSession(token,()=>current===generation.current&&!signal?.aborted)
    if(installed.status==='failed'){authForm.current?.setServerErrors({form:installed.message});return}
    if(installed.status!=='installed')return
    if(onSessionCreated){onSessionCreated(token);return}
    onFinished?.()
    if(presentation==='modal')window.location.reload()
    else window.location.replace('/')
  }
  async function cfx(ticket:string,_attemptId:string,signal:AbortSignal) {
    const current=++generation.current
    const result=await api.POST('/auth/cfx/sign-in',{body:{identityTicket:ticket},signal,alert:false})
    if(current!==generation.current||signal.aborted)return
    if(result.kind==='signed-in')await acceptSession(result.token,current,signal)
    else if(result.kind==='registration-required'){pendingDraft.current=null;setCfxGrant(result)}
    else {setEmail(result.email);setCfxNotice('该邮箱已有账号，请登录后在设置中主动关联 Cfx。')}
  }

  function join() {
    generation.current += 1
    pendingDraft.current = null
    if (onJoin) onJoin()
    else navigate('/register')
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

  if(cfxGrant!==null&&ssoRequestId===undefined)return <PublicRegistrationFlow presentation={presentation} initialGrant={cfxGrant} onSessionCreated={onSessionCreated}
    onLogin={targetEmail=>{setCfxGrant(null);setEmail(targetEmail);setStep('credentials')}}/>

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
      key={email}
      ref={authForm}
      step={step}
      busy={flowBusy||cfxBusy}
      initialEmail={email}
      description={description}
      onContinueLogin={continueLogin}
      onCaptchaSubmit={submitCaptcha}
      onJoin={join}
      />
      {cfxNotice&&<p role="status">{cfxNotice}</p>}
      {ssoRequestId===undefined&&step==='credentials'&&<CfxAuthorization disabled={flowBusy} onActiveChange={setCfxBusy} onTicket={cfx}/>}
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
