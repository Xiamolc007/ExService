import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Button, Spinner } from '@exre/exui'
import { CircleAlert, CircleCheck, Info } from 'lucide-react'
import { api } from '@web/src/api/client'
import { ExAxiosError } from '@workspace/sdk/http/browser'
import { readToken, removeMatchingToken, subscribeSessionChanges } from '@web/src/auth/storage'

import { parseDocsReturnPath } from './docsReturnPath'
import { docsResumeUrl, replaceDocsResume } from './docsResumeNavigation'
import styles from './SignedOutStatus.module.scss'

type Result = 'checking' | 'signed-out' | 'active' | 'unavailable'

export function SignedOutPage() {
  const location = useLocation()
  const hints = new URLSearchParams(location.search).getAll('docsReturnTo')
  const target = parseDocsReturnPath(hints.length === 1 ? hints[0] : null, window.location.origin)
  const returnPath = target.path
  const validReturn = target.valid
  const [result, setResult] = useState<Result>('checking')
  const generation = useRef(0)

  const check = useCallback(async () => {
    const current = ++generation.current
    setResult('checking')
    let token: string | null
    try {
      token = readToken(window.localStorage)
    } catch {
      setResult('unavailable')
      return
    }
    const finishSignedOut = () => {
      if (generation.current !== current || readToken(window.localStorage) !== null) return
      setResult('signed-out')
      if (validReturn) replaceDocsResume(returnPath)
    }
    if (token === null) {
      try { finishSignedOut() } catch { setResult('unavailable') }
      return
    }
    try {
      await api.GET('/auth/me', {
        headers: { Authorization: `Bearer ${token}` }, alert: false,
      })
      if (generation.current !== current) return
      if (readToken(window.localStorage) !== token) {
        setResult('unavailable')
        return
      }
      setResult('active')
    } catch (error) {
      if (generation.current !== current) return
      if (error instanceof ExAxiosError && error.code === 'SESSION_INVALID') {
        try {
          if (readToken(window.localStorage) !== token) { setResult('unavailable'); return }
          removeMatchingToken(window.localStorage, token)
          finishSignedOut()
        } catch { setResult('unavailable') }
      } else {
        setResult('unavailable')
      }
    }
  }, [validReturn, returnPath])

  useEffect(() => {
    void check()
    const unsubscribe = subscribeSessionChanges(() => { void check() })
    return () => { generation.current += 1; unsubscribe() }
  }, [check])

  return <main>
    <h1>文档服务退出</h1>
    <section className={styles.status} role={result === 'unavailable' ? 'alert' : 'status'} aria-busy={result === 'checking' ? true : undefined}>
      {result === 'checking' ? <Spinner aria-hidden="true" className={styles.spinner} /> : result === 'unavailable' ? <CircleAlert aria-hidden="true" /> : result === 'signed-out' ? <CircleCheck aria-hidden="true" /> : <Info aria-hidden="true" />}
      <h2>{result === 'checking' ? '正在确认登录状态' : result === 'signed-out' ? '已退出登录' : result === 'active' ? '网站会话仍有效' : '暂时无法确认登录状态'}</h2>
      <p>{result === 'checking' ? '正在核验当前浏览器会话，请稍候。' : result === 'signed-out' ? '当前浏览器已退出。公开文档仍可阅读。' : result === 'active' ? '当前浏览器有有效的网站登录会话。' : '暂时无法确认登录状态，请稍后重试。'}</p>
      {result === 'unavailable' && <Button type="button" onClick={() => void check()}>重试</Button>}
    </section>
    <Link to="/">返回网站首页</Link>
    <a href={validReturn ? docsResumeUrl(returnPath) : "/docs/"}>返回公开文档</a>
  </main>
}
