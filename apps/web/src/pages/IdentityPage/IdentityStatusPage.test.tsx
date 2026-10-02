// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

let authStatus: 'loading' | 'authenticated' | 'anonymous' | 'unavailable' = 'loading'
vi.mock('@web/src/auth/AuthContext', () => ({
  useAuth: () => ({ state: { status: authStatus } }),
}))

import { IdentityStatusPage } from '@web/src/pages/IdentityPage/IdentityStatusPage'

const nonce = 'a'.repeat(22)
const origin = window.location.origin

function request(overrides: { origin?: string; source?: MessageEventSource | null; nonce?: unknown } = {}) {
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'identity-status-request', nonce: overrides.nonce ?? nonce },
    origin: overrides.origin ?? origin,
    source: overrides.source === undefined ? window.parent : overrides.source,
  }))
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  authStatus = 'loading'
})

describe('identity status iframe', () => {
  it('answers a same-origin parent once without a token or profile, even when referrer is absent', () => {
    authStatus = 'authenticated'
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
    expect(document.referrer).toBe('')
    render(<IdentityStatusPage />)
    expect(postMessage).toHaveBeenCalledWith({ type: 'identity-status-ready' }, origin)
    postMessage.mockClear()

    act(() => request())
    expect(postMessage).toHaveBeenCalledWith({ type: 'identity-status', nonce, status: 'active' }, origin)
    expect(JSON.stringify(postMessage.mock.calls)).not.toMatch(/token|nickname|avatar|email/i)
    act(() => request())
    expect(postMessage).toHaveBeenCalledTimes(1)
  })

  it('rejects wrong origin, source and malformed nonce', () => {
    authStatus = 'anonymous'
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
    render(<IdentityStatusPage />)
    postMessage.mockClear()
    act(() => request({ origin: 'https://other.example' }))
    act(() => request({ source: null }))
    act(() => request({ nonce: 'bad' }))
    expect(postMessage).not.toHaveBeenCalled()
    act(() => request())
    expect(postMessage).toHaveBeenCalledWith({ type: 'identity-status', nonce, status: 'anonymous' }, origin)
  })

  it('returns unavailable at one second and ignores a late active session', () => {
    vi.useFakeTimers()
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
    const view = render(<IdentityStatusPage />)
    postMessage.mockClear()
    act(() => request())
    act(() => vi.advanceTimersByTime(1_000))
    expect(postMessage).toHaveBeenCalledWith({ type: 'identity-status', nonce, status: 'unavailable' }, origin)
    authStatus = 'authenticated'
    view.rerender(<IdentityStatusPage />)
    expect(postMessage).toHaveBeenCalledTimes(1)
  })
})
