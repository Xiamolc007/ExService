import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AuthDisplayState, AuthMode } from '@workspace/components'
import { api } from '@web/src/api/client'
import { AUTH_TOKEN_KEY, readToken, removeMatchingToken } from '@web/src/auth/storage'

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
      const { data, error } = await api.GET('/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (currentGeneration !== generation.current) {
        return
      }
      if (readToken(window.localStorage) !== token) return
      if (data !== undefined) {
        setState({
          status: 'authenticated',
          nickname: data.nickname,
          initial: firstVisibleCharacter(data.nickname),
          avatarUrl: data.avatarUrl ?? null,
        })
        return
      }
      if (error.error.code === 'SESSION_INVALID') {
        removeMatchingToken(window.localStorage, token)
        setState({ status: 'anonymous' })
        return
      }
      setState({ status: 'unavailable', message: error.error.message })
    } catch {
      if (currentGeneration === generation.current) {
        setState({ status: 'unavailable', message: '暂时无法连接认证服务' })
      }
    }
  }, [])

  useEffect(() => {
    void restoreSession()
    const onStorage = (event: StorageEvent) => {
      if (event.key === AUTH_TOKEN_KEY) {
        void restoreSession()
      }
    }
    window.addEventListener('storage', onStorage)
    return () => {
      generation.current += 1
      window.removeEventListener('storage', onStorage)
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
      const { error } = await api.POST('/auth/logout', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (error !== undefined && error.error.code !== 'SESSION_INVALID') {
        setState({ status: 'unavailable', message: error.error.message })
        return
      }
      removeMatchingToken(window.localStorage, token)
      window.location.reload()
    } catch {
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
