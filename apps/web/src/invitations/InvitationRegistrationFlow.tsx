import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Alert, AlertDescription, Button, ExMessage } from '@exre/exui'
import { InvitationEmailForm, InvitationCodeForm, InvitationProfileForm, invitationEmailSchema, type AuthFormHandle, type InvitationProfileValues } from '@workspace/components'
import type { components } from '@workspace/api-client'
import { api } from '@web/src/api/client'
import { ExAxiosError } from '@workspace/sdk/http/browser'

interface Props { presentation: 'page' | 'modal'; initialEmail?: string; onLogin?: (email: string) => void; onJoin?: () => void }
type Verified = components['schemas']['InvitationVerified']
const noApplication = '未找到该邮箱的申请，请先申请加入'
const notEligible = '该邮箱暂不符合注册条件，请确认申请已通过且邀请仍有效'

function readEntry(presentation: Props['presentation'], initialEmail: string) {
  if (presentation === 'modal' || typeof window === 'undefined') return { email: initialEmail, code: null as string | null, error: false }
  const params = new URLSearchParams(window.location.search)
  const emails = params.getAll('email'), codes = params.getAll('code')
  const email = invitationEmailSchema.safeParse(emails[0] ?? '')
  const invalid = emails.length > 1 || codes.length > 1 || (emails.length === 1 && !email.success) || (codes.length > 0 && (emails.length !== 1 || !email.success || !/^[0-9]{6}$/.test(codes[0]!)))
  return { email: email.success && emails.length === 1 ? email.data : initialEmail, code: !invalid && codes.length === 1 ? codes[0]! : null, error: invalid }
}

export function InvitationRegistrationFlow({ presentation, initialEmail = '', onLogin, onJoin }: Props) {
  const navigate = useNavigate()
  const entry = useRef<ReturnType<typeof readEntry> | null>(null)
  if (entry.current === null) entry.current = readEntry(presentation, initialEmail)
  const [email, setEmail] = useState(entry.current.email)
  const [step, setStep] = useState<'email' | 'code' | 'profile' | 'registered'>('email')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(false)
  const [error, setError] = useState<string | null>(entry.current.error ? '注册入口参数无效，请重新填写邮箱' : null)
  const [nickname, setNickname] = useState('')
  const [resendUntil, setResendUntil] = useState(0)
  const [lockedUntil, setLockedUntil] = useState(0)
  const [clock, setClock] = useState(Date.now())
  const generation = useRef(0), mounted = useRef(false), pending = useRef(false)
  const grant = useRef<Verified | null>(null)
  const form = useRef<AuthFormHandle>(null)
  const timer = useRef<number | null>(null), finished = useRef(false)
  const autoChain = useRef<ReturnType<typeof runAutomatic> | null>(null)

  const valid = (current: number) => mounted.current && current === generation.current
  function cooldown(data: { serverTime: number; resendAvailableAt: number }) {
    const now = Date.now(), delay = Math.max(0, data.resendAvailableAt - data.serverTime)
    setClock(now); setResendUntil(delay === 0 ? 0 : now + delay)
  }
  function checkFailure(status: number | undefined) {
    const message = status === 404 ? noApplication : status === 409 ? notEligible : '检查失败，请重试'
    setError(message); form.current?.setServerErrors({ form: message }); ExMessage.error(message)
  }
  function verifyFailure(message: string, retryAfter = 0) {
    setRetry(true); setError(message)
    // The automatic entry has an empty OTP form mounted on its next render.
    if (retryAfter > 0) { const now = Date.now(); setClock(now); setLockedUntil(now + retryAfter * 1000) }
    form.current?.setServerErrors({ code: message })
  }
  function accepted(data: Verified) { grant.current = data; setEmail(data.email); setNickname(data.nickname); setError(null); setRetry(false); setStep('profile') }
  async function runAutomatic(current: number, targetEmail: string, code: string) {
    let inspected
    try { inspected = await api.POST('/auth/invitations/check', { body: { email: targetEmail }, alert: false }) }
    catch (error) { return { stage: 'checkFailure' as const, error } }
    if (!valid(current)) return null
    try {
      const result = await api.POST('/auth/invitations/verify', { body: { email: inspected.email, code }, alert: false })
      return { stage: 'verify' as const, result, eligibility: inspected }
    } catch (error) { return { stage: 'verifyFailure' as const, error, eligibility: inspected } }
  }
  useEffect(() => {
    mounted.current = true
    let subscribed = true
    const current = generation.current
    if (presentation === 'page') {
      const url = new URL(window.location.href)
      url.searchParams.delete('code')
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    }
    if (entry.current!.code !== null && autoChain.current === null) {
      const code = entry.current!.code
      entry.current!.code = null
      pending.current = true; setBusy(true)
      autoChain.current = runAutomatic(current, entry.current!.email, code)
    }
    if (autoChain.current !== null) void autoChain.current.then(outcome => {
      if (!subscribed || !valid(current) || outcome === null) return
      pending.current = false; setBusy(false)
      autoChain.current = null
      if (outcome.stage === 'checkFailure') { checkFailure(outcome.error instanceof ExAxiosError ? outcome.error.status : undefined); return }
      cooldown(outcome.eligibility); setEmail(outcome.eligibility.email)
      if (outcome.stage === 'verify') { accepted(outcome.result); return }
      setStep('code')
      verifyFailure(outcome.error instanceof ExAxiosError && outcome.error.code === 'INVITATION_CODE_LOCKED' ? '验证暂时锁定，请稍后重试' : '验证码无效或已过期，请重新获取', retrySeconds(outcome.error))
    })
    const interval = window.setInterval(() => setClock(Date.now()), 1000)
    return () => {
      subscribed = false; mounted.current = false
      window.clearInterval(interval)
      if (timer.current !== null) window.clearTimeout(timer.current)
      // StrictMode immediately re-subscribes; real unmount invalidates the flow.
      queueMicrotask(() => { if (!mounted.current) { generation.current++; grant.current = null; entry.current!.code = null; autoChain.current = null } })
    }
  }, [])

  function invalidate() {
    generation.current++; pending.current = false; grant.current = null; autoChain.current = null
    entry.current!.code = null
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null }
    setBusy(false); setRetry(false); setError(null)
  }
  function back() { invalidate(); setNickname(''); setLockedUntil(0); setResendUntil(0); setStep('email') }
  async function check(targetEmail: string) {
    if (pending.current) return
    const current = ++generation.current
    pending.current = true; setBusy(true); setEmail(targetEmail); setError(null); form.current?.clearServerErrors()
    try {
      const result = await api.POST('/auth/invitations/check', { body: { email: targetEmail }, alert: false })
      if (!valid(current)) return
      cooldown(result); setEmail(result.email); setStep('code')
    } catch (error) { if (valid(current)) {
      if (error instanceof ExAxiosError && error.status === 400) form.current?.setServerErrors({ email: '请输入有效的邮箱地址' })
      else { checkFailure(error instanceof ExAxiosError ? error.status : undefined); if (error instanceof ExAxiosError && error.status === 429) setError(`检查失败，请在 ${retrySeconds(error)} 秒后重试`) }
    } }
    finally { if (valid(current)) { pending.current = false; setBusy(false) } }
  }
  async function verify(code: string) {
    if (pending.current || Date.now() < lockedUntil) return
    const current = generation.current
    pending.current = true; setBusy(true); setRetry(false); setError(null); form.current?.clearServerErrors()
    try {
      const result = await api.POST('/auth/invitations/verify', { body: { email, code }, alert: false })
      if (!valid(current)) return
      accepted(result)
    } catch (error) { if (valid(current)) verifyFailure(error instanceof ExAxiosError && error.code === 'INVITATION_CODE_LOCKED' ? '验证暂时锁定，请稍后重试' : '验证码无效或已过期，请重新获取', retrySeconds(error)) }
    finally { if (valid(current)) { pending.current = false; setBusy(false) } }
  }
  async function resend() {
    if (pending.current || Date.now() < lockedUntil || Date.now() < resendUntil) return false
    const current = generation.current
    pending.current = true; setBusy(true); setError(null); form.current?.clearServerErrors()
    try {
      const result = await api.POST('/auth/invitations/code', { body: { email }, alert: false })
      if (!valid(current)) return false
      cooldown(result); setRetry(false); ExMessage.info('如邮箱符合邀请条件，将发送验证码'); return true
    } catch { if (valid(current)) setError('发送失败，请重试'); return false }
    finally { if (valid(current)) { pending.current = false; setBusy(false) } }
  }
  function login() {
    if (finished.current) return
    finished.current = true; invalidate()
    if (presentation === 'page') navigate('/login', { replace: true, state: { email } })
    else onLogin?.(email)
  }
  async function complete(values: InvitationProfileValues) {
    if (pending.current || grant.current === null) return
    const current = generation.current, completionToken = grant.current.completionToken
    pending.current = true; setBusy(true); setError(null); form.current?.clearServerErrors()
    try {
      await api.POST('/auth/invitations/complete', { body: { completionToken, ...values }, alert: false })
      if (!valid(current)) return
      grant.current = null; setNickname(''); setStep('registered'); ExMessage.info('注册成功，请前往登录')
    } catch (error) { if (valid(current)) { const message = error instanceof ExAxiosError && error.code === 'COMPLETION_GRANT_INVALID' ? '验证已过期，请返回邮箱重新验证' : '注册失败，请重试'; setError(message); form.current?.setServerErrors({ form: message }) } }
    finally { if (valid(current)) { pending.current = false; setBusy(false) } }
  }
  useEffect(() => {
    if (step !== 'registered') return
    timer.current = window.setTimeout(login, 1500)
    return () => { if (timer.current !== null) window.clearTimeout(timer.current) }
  }, [step])
  useEffect(() => {
    if (step === 'code' && error !== null) form.current?.setServerErrors({ code: error })
  }, [step, error])
  const join = () => { invalidate(); if (onJoin) onJoin(); else navigate('/join/rifling-911') }
  return <>
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {step === 'email' && <InvitationEmailForm ref={form} initialEmail={email} busy={busy} onSubmit={check} onEmailChange={invalidate} onLogin={login} onJoin={join} />}
    {step === 'code' && <InvitationCodeForm ref={form} email={email} busy={busy} retry={retry} resendSeconds={Math.max(0, Math.ceil((resendUntil - clock) / 1000))} lockedSeconds={Math.max(0, Math.ceil((lockedUntil - clock) / 1000))} onVerify={verify} onResend={resend} onBack={back} />}
    {step === 'profile' && <InvitationProfileForm ref={form} email={email} nickname={nickname} busy={busy} onSubmit={complete} onBack={back} />}
    {step === 'registered' && <section aria-live="polite"><h2>注册成功</h2><p>账号已创建，即将前往登录。</p><Button onClick={login}>前往登录</Button></section>}
  </>
}

function retrySeconds(error: unknown) { return error instanceof ExAxiosError && error.retryAfterSeconds !== undefined && error.retryAfterSeconds > 0 ? error.retryAfterSeconds : 0 }
