// @vitest-environment jsdom
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { ExAxiosError } from '@workspace/sdk/http/browser'

const { post, navigate } = vi.hoisted(() => ({ post: vi.fn(), navigate: vi.fn() }))
vi.mock('react-router', async importOriginal => ({
  ...await importOriginal<typeof import('react-router')>(), useNavigate: () => navigate,
}))
vi.mock('@web/src/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@web/src/api/client')>(), api: { POST: post },
}))

import { AuthFlow } from '@web/src/auth/AuthFlow'
import { AUTH_TOKEN_KEY, SSO_SUCCESS_KEY } from '@web/src/auth/storage'

class TestResizeObserver { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal('ResizeObserver', TestResizeObserver)
Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.body })

const requestId = 's'.repeat(43)
const pending = { ssoRequestId: requestId, status: 'pending', serverTime: 1_700_000_000_000, expiresAt: 1_700_000_600_000 }
const completed = { ssoRequestId: requestId, status: 'completed' }
const httpError = (status: number) => new ExAxiosError('http', 'HTTP_ERROR', 'private backend message', { status })
function show(strict = false) {
  const flow = <MemoryRouter><AuthFlow presentation="page" ssoRequestId={requestId} /></MemoryRouter>
  return render(strict ? <StrictMode>{flow}</StrictMode> : flow)
}
async function passwordLogin() {
  const user = userEvent.setup()
  await waitFor(() => expect((screen.getByLabelText('邮箱') as HTMLInputElement).disabled).toBe(false))
  await user.type(screen.getByLabelText('邮箱'), 'sso@example.com')
  await user.type(screen.getByLabelText('密码', { exact: true }), 'password-one')
  await user.click(screen.getByRole('button', { name: '继续' }))
  await waitFor(() => expect(post).toHaveBeenCalledWith('/auth/captcha/challenges', { alert: false }))
  await user.type(screen.getByLabelText('图片验证码'), 'abcd')
  await user.click(screen.getByRole('button', { name: '登录' }))
}
beforeEach(() => {
  post.mockImplementation((path: string) => Promise.resolve({ data: path === '/auth/sso/inspect'
    ? pending : path === '/auth/captcha/challenges' ? { challengeId: 'challenge', imageBase64: 'image' } : completed }))
})
afterEach(() => {
  cleanup(); post.mockReset(); navigate.mockReset()
  window.localStorage.clear(); window.sessionStorage.clear()
})

describe('device SSO login', () => {
  it('completes password SSO with the actual captcha fields, without creating a website session', async () => {
    show()
    await passwordLogin()
    expect(post).toHaveBeenLastCalledWith('/auth/sso/login', {
      body: { ssoRequestId: requestId, email: 'sso@example.com', password: 'password-one', captcha: { challengeId: 'challenge', answer: 'abcd' } }, alert: false,
    })
    expect(navigate).toHaveBeenCalledWith('/sso/success', { replace: true })
    expect(JSON.parse(window.sessionStorage.getItem(SSO_SUCCESS_KEY)!)).toMatchObject({ ssoRequestId: requestId })
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull()
  })

  it('confirms the captured website token once under StrictMode', async () => {
    window.localStorage.setItem(AUTH_TOKEN_KEY, 'website-token')
    show(true)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/sso/success', { replace: true }))
    const confirms = post.mock.calls.filter(([path]) => path === '/auth/sso/confirm')
    expect(confirms).toEqual([['/auth/sso/confirm', { body: { ssoRequestId: requestId }, headers: { Authorization: 'Bearer website-token' }, alert: false }]])
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBe('website-token')
  })

  it('shows an already completed request without confirming it again', async () => {
    post.mockResolvedValue({ data: { ...pending, status: 'completed' } })
    show()
    await waitFor(() => expect(navigate).toHaveBeenCalled())
    expect(post).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('clears only the expired token and keeps the password form (replacement: %s)', async replaced => {
    window.localStorage.setItem(AUTH_TOKEN_KEY, 'expired-token')
    let rejectConfirm!: (error: unknown) => void
    post.mockImplementation((path: string) => path === '/auth/sso/inspect' ? Promise.resolve({ data: pending })
      : new Promise((_resolve, reject) => { rejectConfirm = reject }))
    show()
    await waitFor(() => expect(rejectConfirm).toBeDefined())
    if (replaced) window.localStorage.setItem(AUTH_TOKEN_KEY, 'new-token')
    await act(async () => rejectConfirm(httpError(401)))
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBe(replaced ? 'new-token' : null)
    expect((screen.getByLabelText('邮箱') as HTMLInputElement).disabled).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  it.each([400, 403, 404, 409])('does not retry a terminal request (%s)', async status => {
    post.mockRejectedValue(httpError(status))
    show()
    expect(await screen.findByText(/登录请求已失效或无法授权/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
    expect(screen.getByRole('button', { name: '返回首页' })).toBeTruthy()
    expect(window.sessionStorage.getItem(SSO_SUCCESS_KEY)).toBeNull()
  })

  it('rejects an expired inspect response', async () => {
    post.mockResolvedValue({ data: { ...pending, expiresAt: pending.serverTime } })
    show()
    expect(await screen.findByText(/登录请求已失效，请从发起应用重新登录/)).toBeTruthy()
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('allows a transient network failure to be retried', async () => {
    const user = userEvent.setup()
    post.mockRejectedValueOnce(new Error('offline'))
    show()
    await user.click(await screen.findByRole('button', { name: '重试' }))
    await waitFor(() => expect((screen.getByLabelText('邮箱') as HTMLInputElement).disabled).toBe(false))
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('rejects confirmation when the browser account changes while waiting', async () => {
    window.localStorage.setItem(AUTH_TOKEN_KEY, 'first-token')
    let resolveConfirm!: (data: unknown) => void
    post.mockImplementation((path: string) => path === '/auth/sso/inspect' ? Promise.resolve({ data: pending })
      : new Promise(resolve => { resolveConfirm = resolve }))
    show()
    await waitFor(() => expect(resolveConfirm).toBeDefined())
    window.localStorage.setItem(AUTH_TOKEN_KEY, 'second-token')
    await act(async () => resolveConfirm({ data: completed }))
    expect(await screen.findByText(/登录账号已变更/)).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBe('second-token')
  })

  it('does not show success for a mismatched completion response', async () => {
    window.localStorage.setItem(AUTH_TOKEN_KEY, 'website-token')
    post.mockImplementation((path: string) => Promise.resolve({ data: path === '/auth/sso/inspect'
      ? pending : { ...completed, ssoRequestId: 'other-request' } }))
    show()
    expect(await screen.findByRole('button', { name: '重试' })).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem(SSO_SUCCESS_KEY)).toBeNull()
  })

  it('shows a terminal message if the request is revoked before password submission', async () => {
    const original = post.getMockImplementation()!
    post.mockImplementation((path: string, ...args: unknown[]) => path === '/auth/sso/login'
      ? Promise.reject(httpError(404)) : original(path, ...args))
    show()
    await passwordLogin()
    expect(await screen.findByText(/登录请求已失效或已被处理/)).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
  })
})
