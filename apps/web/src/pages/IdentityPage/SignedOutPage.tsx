import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@exre/exui'
import { api } from '@web/src/api/client'
import { ExAxiosError } from '@workspace/sdk/http/browser'
import { readToken, removeMatchingToken } from '@web/src/auth/storage'

type Result = 'checking' | 'signed-out' | 'active' | 'unavailable'

export function SignedOutPage() {
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
    if (token === null) {
      setResult('signed-out')
      return
    }
    try {
      await api.GET('/auth/me', {
        headers: { Authorization: `Bearer ${token}` }, alert: false,
      })
      if (generation.current !== current) return
      setResult('active')
    } catch (error) {
      if (generation.current !== current) return
      if (error instanceof ExAxiosError && error.code === 'SESSION_INVALID') {
        removeMatchingToken(window.localStorage, token)
        setResult(readToken(window.localStorage) === null ? 'signed-out' : 'active')
      } else {
        setResult('unavailable')
      }
    }
  }, [])

  useEffect(() => {
    void check()
    return () => { generation.current += 1 }
  }, [check])

  return <main>
    <h1>文档服务退出</h1>
    {result === 'checking' && <p role="status">正在确认登录状态…</p>}
    {result === 'signed-out' && <p>当前浏览器已退出。公开文档仍可阅读。</p>}
    {result === 'active' && <p>当前浏览器有有效的网站登录会话。</p>}
    {result === 'unavailable' && <>
      <p role="alert">暂时无法确认登录状态，请稍后重试。</p>
      <Button type="button" onClick={() => void check()}>重试</Button>
    </>}
    <Link to="/">返回网站首页</Link>
    <a href="/docs">返回公开文档</a>
  </main>
}
