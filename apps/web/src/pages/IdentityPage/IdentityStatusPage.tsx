import { useEffect, useRef } from 'react'
import { useAuth } from '@web/src/auth/AuthContext'

type Status = 'active' | 'anonymous' | 'unavailable'
type PendingRequest = { nonce: string; timer: ReturnType<typeof setTimeout> }

function isNonce(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{22,128}$/.test(value)
}

/** The only cross-window payload is a nonce and a coarse session state. */
export function IdentityStatusPage() {
  const { state } = useAuth()
  const status = useRef(state.status)
  status.current = state.status
  const pending = useRef<PendingRequest | null>(null)
  const answered = useRef(false)

  useEffect(() => {
    const parent = window.parent
    const origin = window.location.origin
    const reply = (nonce: string, value: Status) => {
      if (answered.current) return
      answered.current = true
      if (pending.current !== null) clearTimeout(pending.current.timer)
      pending.current = null
      parent.postMessage({ type: 'identity-status', nonce, status: value }, origin)
    }
    const onMessage = (event: MessageEvent) => {
      if (answered.current || pending.current !== null || event.origin !== origin || event.source !== parent) return
      const data: unknown = event.data
      if (typeof data !== 'object' || data === null || !('type' in data) || !('nonce' in data)
        || data.type !== 'identity-status-request' || !isNonce(data.nonce)) return

      const nonce = data.nonce
      const current = status.current
      if (current === 'authenticated') return reply(nonce, 'active')
      if (current === 'anonymous' || current === 'unavailable') return reply(nonce, current)
      pending.current = { nonce, timer: setTimeout(() => reply(nonce, 'unavailable'), 1_000) }
    }
    window.addEventListener('message', onMessage)
    // A parent installs its listener before loading the iframe, then waits for this handshake.
    parent.postMessage({ type: 'identity-status-ready' }, origin)
    return () => {
      window.removeEventListener('message', onMessage)
      if (pending.current !== null) clearTimeout(pending.current.timer)
      pending.current = null
    }
  }, [])

  useEffect(() => {
    const request = pending.current
    if (request === null || answered.current) return
    const current = status.current
    if (current === 'loading') return
    answered.current = true
    clearTimeout(request.timer)
    pending.current = null
    window.parent.postMessage({
      type: 'identity-status',
      nonce: request.nonce,
      status: current === 'authenticated' ? 'active' : current,
    }, window.location.origin)
  }, [state.status])

  return <main aria-label="登录状态检查" />
}
