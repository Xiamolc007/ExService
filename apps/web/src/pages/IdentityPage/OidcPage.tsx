import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Alert, AlertDescription, Button, Card } from '@exre/exui'
import { api } from '@web/src/api/client'
import { AuthFlow } from '@web/src/auth/AuthFlow'
import { readToken, removeMatchingToken } from '@web/src/auth/storage'
import { AuthBackdrop } from '@web/src/pages/AuthPage/AuthBackdrop'
import styles from '@web/src/pages/AuthPage/AuthPage.module.scss'

type Phase = 'login' | 'consent' | 'logout'
type ClientInfo = { clientName: string; scopes: string[] }
type Stage = 'checking' | 'login-required' | 'restart' | 'retry-inspect' | 'retry-accept' | 'invalid'

function inspectOidc(phase: 'login' | 'consent', challenge: string) {
  return api.POST('/auth/oidc/inspect', { body: { phase, challenge } })
}

function acceptOidc(phase: Phase, challenge: string, token: string) {
  const request = { body: { challenge }, headers: { Authorization: `Bearer ${token}` } }
  if (phase === 'login') return api.POST('/auth/oidc/login/accept', request)
  if (phase === 'consent') return api.POST('/auth/oidc/consent/accept', request)
  return api.POST('/auth/oidc/logout/accept', request)
}

function challengeFromSearch(search: string, phase: Phase): string | null {
  const params = new URLSearchParams(search)
  const key = `${phase}_challenge`
  const values = params.getAll(key)
  if (values.length !== 1 || Array.from(params.keys()).some(name => name !== key)) return null
  const challenge = values[0]
  return challenge && challenge.length <= 8192 && !/\s/u.test(challenge) && !/[\u0000-\u001f\u007f]/u.test(challenge)
    ? challenge
    : null
}

function currentToken(): string | null {
  try {
    return readToken(window.localStorage)
  } catch {
    return null
  }
}

function redirectToHydra(value: string): boolean {
  try {
    const url = new URL(value, window.location.origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    window.location.replace(url.href)
    return true
  } catch {
    return false
  }
}

/** Completes one approved Hydra challenge through the generated Website client. */
export function OidcPage({ phase }: { phase: Phase }) {
  const location = useLocation()
  return <OidcChallenge key={`${phase}:${location.search}`} phase={phase} search={location.search} />
}

function OidcChallenge({ phase, search }: { phase: Phase; search: string }) {
  const navigate = useNavigate()
  const challenge = challengeFromSearch(search, phase)
  const [token, setToken] = useState(currentToken)
  const [info, setInfo] = useState<ClientInfo | null>(null)
  const [stage, setStage] = useState<Stage>('checking')
  const [attempt, setAttempt] = useState(0)
  const inspectRequest = useRef<{ key: string; promise: ReturnType<typeof inspectOidc> } | null>(null)
  const acceptRequest = useRef<{ key: string; promise: ReturnType<typeof acceptOidc> } | null>(null)

  useEffect(() => {
    if (challenge === null || phase === 'logout') return
    let active = true
    const key = `${phase}:${challenge}`
    if (inspectRequest.current?.key !== key) {
      inspectRequest.current = {
        key,
        promise: inspectOidc(phase, challenge),
      }
    }
    void inspectRequest.current.promise.then(result => {
      if (!active) return
      if (result.data !== undefined) {
        setInfo(result.data)
        setStage('checking')
      } else {
        setStage(result.response?.status === 503 ? 'retry-inspect'
          : result.response?.status === 400 || result.response?.status === 403 ? 'invalid' : 'retry-inspect')
      }
    }).catch(() => { if (active) setStage('retry-inspect') })
    return () => { active = false }
  }, [challenge, phase, attempt])

  useEffect(() => {
    if (challenge === null || (phase !== 'logout' && info === null)
      || stage === 'invalid' || stage === 'restart'
      || stage === 'retry-inspect' || stage === 'retry-accept') return
    if (token === null) {
      if (phase === 'logout') {
        navigate('/identity/signed-out', { replace: true })
      } else {
        setStage(phase === 'login' ? 'login-required' : 'restart')
      }
      return
    }
    let active = true
    const key = `${phase}:${challenge}:${token}`
    if (acceptRequest.current?.key !== key) {
      acceptRequest.current = {
        key,
        promise: acceptOidc(phase, challenge, token),
      }
    }
    void acceptRequest.current.promise.then(result => {
      if (!active) return
      const latestToken = currentToken()
      if (latestToken !== token) {
        setToken(latestToken)
        setStage('restart')
        return
      }
      if (result.data !== undefined) {
        if (phase === 'logout') removeMatchingToken(window.localStorage, token)
        if (!redirectToHydra(result.data.redirectUrl)) setStage('invalid')
        return
      }
      if (result.response?.status === 401 || result.error.error.code === 'SESSION_INVALID') {
        if (phase === 'logout') {
          navigate('/identity/signed-out', { replace: true })
          return
        }
        removeMatchingToken(window.localStorage, token)
        setToken(null)
        setStage(phase === 'login' ? 'login-required' : 'restart')
        return
      }
      setStage(result.response?.status === 400 || result.response?.status === 403 ? 'invalid'
        : result.response?.status === 409 ? 'restart' : 'retry-accept')
    }).catch(() => { if (active) setStage('retry-accept') })
    return () => { active = false }
  }, [challenge, phase, info, token, attempt, navigate, stage])

  const retry = () => {
    if (stage === 'retry-inspect') inspectRequest.current = null
    else acceptRequest.current = null
    setStage('checking')
    setAttempt(value => value + 1)
  }

  return <main className={styles.page} data-page="identity">
    <AuthBackdrop />
    <Card glass className={styles.panel}>
      <h1>{phase === 'logout' ? '退出文档服务' : '继续登录文档服务'}</h1>
      {info !== null && <p>{info.clientName} · {info.scopes.join('、')}</p>}
      {challenge === null || stage === 'invalid' ? <Alert variant="destructive" role="alert">
        <AlertDescription>身份入口无效，请从文档服务重新进入。</AlertDescription>
      </Alert> : stage === 'login-required' && phase === 'login' ? <AuthFlow
        presentation="page" onSessionCreated={value => { setStage('checking'); setToken(value) }}
      /> : stage === 'restart' ? <p role="alert">此登录流程已失效，请重新从文档服务发起登录。</p>
        : stage === 'retry-inspect' || stage === 'retry-accept' ? <>
          <p role="alert">暂时无法连接身份服务，请重试。</p>
          <Button type="button" onClick={retry}>重试</Button>
        </> : <p role="status">正在处理身份请求…</p>}
    </Card>
  </main>
}
