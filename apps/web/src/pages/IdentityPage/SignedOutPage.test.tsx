// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { ExAxiosError } from '@workspace/sdk/http/browser'
import { AUTH_TOKEN_KEY, writeToken } from '@web/src/auth/storage'

const { get, replace } = vi.hoisted(() => ({ get: vi.fn(), replace: vi.fn() }))
vi.mock('./docsResumeNavigation', async (original) => ({ ...(await original<typeof import('./docsResumeNavigation')>()), replaceDocsResume: replace }))
vi.mock('@web/src/api/client', () => ({ api: { GET: get } }))

import { SignedOutPage } from '@web/src/pages/IdentityPage/SignedOutPage'

afterEach(() => { cleanup(); vi.restoreAllMocks(); get.mockReset(); replace.mockReset(); window.localStorage.clear() })

describe('signed-out landing', () => {
  it('presents a visible loading icon, title and content then retries the failed check', async () => {
    window.localStorage.setItem(AUTH_TOKEN_KEY, 'current-token')
    let reject!: (error: Error) => void
    get.mockImplementationOnce(() => new Promise((_done, failure) => { reject = failure })).mockResolvedValue({})
    render(<MemoryRouter><SignedOutPage /></MemoryRouter>)
    const checking = screen.getByRole('status')
    expect(within(checking).getByRole('heading', { name: '正在确认登录状态' })).toBeTruthy()
    expect(checking.querySelector('svg')).toBeTruthy()
    expect(checking.getAttribute('aria-busy')).toBe('true')
    reject(new Error('private upstream detail'))
    const unavailable = await screen.findByRole('alert')
    expect(within(unavailable).getByRole('heading', { name: '暂时无法确认登录状态' })).toBeTruthy()
    expect(unavailable.querySelector('svg')).toBeTruthy()
    expect(unavailable.textContent).not.toContain('private upstream detail')
    fireEvent.click(within(unavailable).getByRole('button', { name: '重试' }))
    await screen.findByText('当前浏览器有有效的网站登录会话。')
    expect(get).toHaveBeenCalledTimes(2)
  })
  it('clears the same token only after the server confirms it is invalid', async () => {
    window.localStorage.setItem(AUTH_TOKEN_KEY, 'expired-token')
    get.mockRejectedValue(new ExAxiosError('http', 'SESSION_INVALID', 'Invalid session', { status: 401 }))
    render(<MemoryRouter><SignedOutPage /></MemoryRouter>)
    expect(await screen.findByText(/当前浏览器已退出/)).toBeTruthy()
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull()
  })

  it('removes only the token confirmed invalid by the profile operation', async () => {
    window.localStorage.setItem(AUTH_TOKEN_KEY, 'old-token')
    get.mockImplementation(async () => {
      window.localStorage.setItem(AUTH_TOKEN_KEY, 'new-token')
      throw new ExAxiosError('http', 'SESSION_INVALID', 'Invalid session', { status: 401 })
    })
    render(<MemoryRouter><SignedOutPage /></MemoryRouter>)
    await waitFor(() => expect(get).toHaveBeenCalledWith('/auth/me', {
      headers: { Authorization: 'Bearer old-token' }, alert: false,
    }))
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBe('new-token')
  })

  it('keeps the current token on network failure and offers retry', async () => {
    window.localStorage.setItem(AUTH_TOKEN_KEY, 'current-token')
    get.mockRejectedValue(new Error('network down'))
    render(<MemoryRouter><SignedOutPage /></MemoryRouter>)
    expect(await screen.findByRole('button', { name: '重试' })).toBeTruthy()
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBe('current-token')
  })
})

it('automatically replaces only a valid return after confirming signed out', async () => {
  render(<MemoryRouter initialEntries={['/identity/signed-out?docsReturnTo=%2Fdocs%2Fdoc%2Fhello-1234567890']}><SignedOutPage /></MemoryRouter>)
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/docs/doc/hello-1234567890'))
})
it('preserves a document search context when entering the anonymous resume flow', async () => {
  render(<MemoryRouter initialEntries={['/identity/signed-out?docsReturnTo=%2Fdocs%2Fdoc%2Fhello-1234567890%3Fq%3Dprivacy%26token%3Dsecret']}><SignedOutPage /></MemoryRouter>)
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/docs/doc/hello-1234567890?q=privacy'))
})
it('preserves newer tokens and does not automatically return on a stale invalid response', async () => {
  window.localStorage.setItem(AUTH_TOKEN_KEY, 'old')
  get.mockImplementation(async () => {
    window.localStorage.setItem(AUTH_TOKEN_KEY, 'new')
    throw new ExAxiosError('http', 'SESSION_INVALID', 'Invalid session', { status: 401 })
  })
  render(<MemoryRouter initialEntries={['/identity/signed-out?docsReturnTo=%2Fdocs%2Fsearch%3Fq%3Dhello']}><SignedOutPage /></MemoryRouter>)
  expect(await screen.findByRole("alert")).toBeTruthy()
  expect(replace).not.toHaveBeenCalled()
  expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBe('new')
})
it('does not treat malformed hints as automatic reading returns', async () => {
  render(<MemoryRouter initialEntries={['/identity/signed-out?docsReturnTo=%2Fdocs%2Flogout']}><SignedOutPage /></MemoryRouter>)
  expect(await screen.findByText('当前浏览器已退出。公开文档仍可阅读。')).toBeTruthy()
  expect(replace).not.toHaveBeenCalled()
})

it('keeps an active verified token and provides a scoped manual resume link', async () => {
  window.localStorage.setItem(AUTH_TOKEN_KEY, 'active')
  get.mockResolvedValue({})
  render(<MemoryRouter initialEntries={['/identity/signed-out?docsReturnTo=%2Fdocs%2Fsearch%3Fq%3Dhello%26collectionId%3D12345678-1234-1234-1234-123456789abc']}><SignedOutPage /></MemoryRouter>)
  await screen.findByText('当前浏览器有有效的网站登录会话。')
  expect(replace).not.toHaveBeenCalled()
  expect(document.querySelector('a[href^="/docs/?docsResume="]')?.getAttribute('href')).toBe('/docs/?docsResume=%2Fdocs%2Fsearch%3Fq%3Dhello%26collectionId%3D12345678-1234-1234-1234-123456789abc')
  expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBe('active')
})
it('refuses automatic navigation when storage cannot be read', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage unavailable') })
  render(<MemoryRouter initialEntries={['/identity/signed-out?docsReturnTo=%2Fdocs%2F']}><SignedOutPage /></MemoryRouter>)
  await screen.findByRole('alert')
  expect(replace).not.toHaveBeenCalled()
  expect(get).not.toHaveBeenCalled()
})
it('subscribes to newer sessions and ignores an older invalid response', async () => {
  window.localStorage.setItem(AUTH_TOKEN_KEY, 'old')
  let reject!: (error: Error) => void
  get.mockImplementationOnce(() => new Promise((_resolve, failure) => { reject = failure })).mockResolvedValue({})
  render(<MemoryRouter initialEntries={['/identity/signed-out?docsReturnTo=%2Fdocs%2F']}><SignedOutPage /></MemoryRouter>)
  writeToken(window.localStorage, 'new')
  await screen.findByText('当前浏览器有有效的网站登录会话。')
  reject(new ExAxiosError('http', 'SESSION_INVALID', 'Invalid session', { status: 401 }))
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBe('new')
  expect(replace).not.toHaveBeenCalled()
})
