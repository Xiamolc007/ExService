import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AuthDisplayState, AuthMode } from '@workspace/components'
import { api } from '@web/src/api/client'
import { ExAxiosError } from '@workspace/sdk/http/browser'
import { readToken, removeMatchingToken, startSessionSync, subscribeSessionChanges } from '@web/src/auth/storage'

interface AuthContextValue {
  state: AuthDisplayState
  modalMode: AuthMode | null
  openModal: (mode: AuthMode) => void
  closeModal: () => void
  retrySession: () => void
  refreshProfile: () => Promise<void>
  invalidateSession: (token: string) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthDisplayState>({ status: 'loading' })
  const [modalMode, setModalMode] = useState<AuthMode | null>(null)
  const generation = useRef(0)

  const invalidateSession = useCallback((token: string) => {
    try {
      if (readToken(window.localStorage) !== token) return
      removeMatchingToken(window.localStorage, token)
      generation.current += 1
      setState({ status: 'anonymous' })
    } catch {
      setState({ status: 'unavailable', message: '浏览器无法读取登录信息' })
    }
  }, [])

  const restoreSession = useCallback(async (showLoading = true) => {
    const currentGeneration = ++generation.current
    if (showLoading) setState({ status: 'loading' })
    let token: string | null
    try {
      token = readToken(window.localStorage)
    } catch {
      setState({ status: 'unavailable', message: '浏览器无法读取登录信息' })
      return
    }
    if (token === null) {
      setState({ status: 'anonymous' })
      return
    }
    try {
      const data = await api.GET('/auth/me', { alert: false })
      if (currentGeneration !== generation.current) {
        return
      }
      if (readToken(window.localStorage) !== token) return
      setState({
          status: 'authenticated',
          nickname: data.nickname,
          initial: firstVisibleCharacter(data.nickname),
          avatarUrl: data.avatarUrl ?? null,
        })
      return
    } catch (error) {
      if (currentGeneration === generation.current) {
        const latestToken = readToken(window.localStorage)
        if (latestToken !== null && latestToken !== token) return
        if (error instanceof ExAxiosError && error.code === 'SESSION_INVALID') setState({ status: 'anonymous' })
        else setState({ status: 'unavailable', message: '暂时无法连接认证服务' })
      }
    }
  }, [])

  useEffect(() => {
    void restoreSession()
    const stopSync = startSessionSync()
    const unsubscribe = subscribeSessionChanges(() => void restoreSession())
    return () => {
      generation.current += 1
      unsubscribe()
      stopSync()
    }
  }, [restoreSession])

  const logout = useCallback(async () => {
    let token: string | null
    try {
      token = readToken(window.localStorage)
    } catch {
      setState({ status: 'unavailable', message: '浏览器无法读取登录信息' })
      return
    }
    if (token === null) {
      setState({ status: 'anonymous' })
      return
    }
    try {
      await api.POST('/auth/logout', { alert: false })
      removeMatchingToken(window.localStorage, token)
      window.location.reload()
    } catch (error) {
      if (error instanceof ExAxiosError && error.code === 'SESSION_INVALID') { removeMatchingToken(window.localStorage, token); window.location.reload(); return }
      setState({ status: 'unavailable', message: '退出失败，请稍后重试' })
    }
  }, [])

  return (
    <AuthContext.Provider value={{
      state,
      modalMode,
      openModal: setModalMode,
      closeModal: () => setModalMode(null),
      retrySession: () => void restoreSession(),
      refreshProfile: () => restoreSession(false),
      invalidateSession,
      logout: () => void logout(),
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === null) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}

function firstVisibleCharacter(value: string): string {
  return Array.from(value.trim())[0] ?? '?'
}
