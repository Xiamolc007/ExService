// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { ExAxiosError } from '@workspace/sdk/http/browser'

const { post, captchaPost } = vi.hoisted(() => ({ post: vi.fn(), captchaPost: vi.fn() }))
vi.mock('@web/src/api/client', async importOriginal => {
  const original = await importOriginal<typeof import('@web/src/api/client')>()
  return { ...original, api: { POST: (path: string, options: unknown) =>
    path === '/auth/captcha/challenges' ? captchaPost(options) : post(path, options) } }
})
vi.mock('@web/src/pages/AuthPage/AuthBackdrop', () => ({ AuthBackdrop: () => null }))

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', TestResizeObserver)
Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.body })

import { AuthFlow } from '@web/src/auth/AuthFlow'
import { AuthPage } from '@web/src/pages/AuthPage'
import { AUTH_TOKEN_KEY } from '@web/src/auth/storage'

beforeEach(() => { captchaPost.mockRejectedValue(new Error('captcha unavailable')) })
afterEach(() => { cleanup(); post.mockReset(); captchaPost.mockReset(); window.localStorage.clear() })

describe('AuthFlow captcha stage', () => {
  it.each([
    { presentation: 'page' as const, sso: false },
    { presentation: 'modal' as const, sso: false },
    { presentation: 'page' as const, sso: true },
  ])('keeps the captcha error after replacing its image for $presentation (SSO: $sso)', async ({ presentation, sso }) => {
    const user = userEvent.setup(), ssoRequestId = sso ? 's'.repeat(43) : undefined
    let finishRefresh!: (value: unknown) => void
    captchaPost.mockResolvedValueOnce({ data: { challengeId: 'first-challenge', imageBase64: 'first-image' } })
      .mockReturnValueOnce(new Promise(resolve => { finishRefresh = resolve }))
    post.mockImplementation((path: string) => path === '/auth/sso/inspect'
      ? Promise.resolve({ ssoRequestId, status: 'pending' })
      : Promise.reject(new ExAxiosError('http', 'CAPTCHA_INVALID', 'private error', { status: 422 })))
    render(<MemoryRouter><AuthFlow presentation={presentation} ssoRequestId={ssoRequestId} /></MemoryRouter>)
    await waitFor(() => expect((screen.getByLabelText('邮箱') as HTMLInputElement).disabled).toBe(false))
    await user.type(screen.getByLabelText('邮箱'), 'member@example.com')
    await user.type(screen.getByLabelText('密码', { exact: true }), 'password-one')
    await user.click(screen.getByRole('button', { name: '继续' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '验证码图片，点击刷新' }).querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,first-image'))
    const input = screen.getByLabelText('图片验证码') as HTMLInputElement
    const form = input.closest('form')
    await user.type(input, 'wrong')
    await user.click(screen.getByRole('button', { name: '登录' }))
    const message = '验证码不正确或已过期，已换新图请重输'
    expect(await screen.findAllByText(message)).toHaveLength(1)
    await act(async () => { finishRefresh({ data: { challengeId: 'next-challenge', imageBase64: 'next-image' } }) })
    expect(screen.getByLabelText('图片验证码')).toBe(input)
    expect(input.closest('form')).toBe(form)
    expect(input.value).toBe('')
    expect(screen.getAllByText(message)).toHaveLength(1)
    expect(captchaPost).toHaveBeenCalledTimes(2)
    expect(screen.queryByLabelText('邮箱')).toBeNull()
    await user.type(input, 'next')
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(post).toHaveBeenLastCalledWith(sso ? '/auth/sso/login' : '/auth/login', {
      body: { ...(sso ? { ssoRequestId } : {}), email: 'member@example.com', password: 'password-one', captcha: { challengeId: 'next-challenge', answer: 'next' } }, alert: false,
    })
  })

  it('removes the legal footer from the actual login page after continuing', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/login']}><AuthPage mode="login" /></MemoryRouter>)
    expect(screen.getByText('By signing up, you agree to our Terms, Acceptable Use, and Privacy Policy.')).toBeTruthy()

    await user.type(screen.getByLabelText('邮箱'), 'member@example.com')
    await user.type(screen.getByLabelText('密码', { exact: true }), 'password-one')
    await user.click(screen.getByRole('button', { name: '继续' }))
    expect(screen.getByRole('heading', { name: '输入验证码' })).toBeTruthy()
    expect(screen.queryByText('By signing up, you agree to our Terms, Acceptable Use, and Privacy Policy.')).toBeNull()
  })

  it('submits ordinary login only after the placeholder step, without a captcha credential', async () => {
    const user = userEvent.setup()
    post.mockRejectedValue(new ExAxiosError('http', 'INVALID_CREDENTIALS', 'Invalid credentials', { status: 400 }))
    render(<MemoryRouter><AuthFlow initialMode="login" presentation="page"
      footer={<p>By signing up, you agree to our Terms, Acceptable Use, and Privacy Policy.</p>} /></MemoryRouter>)

    expect(screen.getByText('By signing up, you agree to our Terms, Acceptable Use, and Privacy Policy.')).toBeTruthy()

    await user.type(screen.getByLabelText('邮箱'), 'member@example.com')
    await user.type(screen.getByLabelText('密码', { exact: true }), 'password-one')
    await user.click(screen.getByRole('button', { name: '继续' }))
    expect(post).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '登录' })).toBeTruthy()
    expect(screen.queryByText('By signing up, you agree to our Terms, Acceptable Use, and Privacy Policy.')).toBeNull()

    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(post).toHaveBeenCalledWith('/auth/login', {
      body: { email: 'member@example.com', password: 'password-one' },
      alert: false,
    })
    expect(await screen.findByText('邮箱或密码错误')).toBeTruthy()

    expect(screen.queryByRole('button', { name: '返回修改资料' })).toBeNull()
  })

  it('uses the same captcha step before SSO password login', async () => {
    const user = userEvent.setup()
    window.localStorage.clear()
    const ssoRequestId = 's'.repeat(43)
    post.mockImplementation((path: string) => path === '/auth/sso/inspect'
      ? Promise.resolve({ ssoRequestId, status: 'pending' })
      : Promise.reject(new ExAxiosError('http', 'INVALID_CREDENTIALS', 'Invalid credentials', { status: 401 })))
    render(<MemoryRouter><AuthFlow initialMode="login" presentation="page" ssoRequestId={ssoRequestId} /></MemoryRouter>)

    await screen.findByRole('button', { name: '继续' })
    await user.type(screen.getByLabelText('邮箱'), 'member@example.com')
    await user.type(screen.getByLabelText('密码', { exact: true }), 'password-one')
    await user.click(screen.getByRole('button', { name: '继续' }))
    expect(post).not.toHaveBeenCalledWith('/auth/sso/login', expect.anything())
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(post).toHaveBeenCalledWith('/auth/sso/login', {
      body: { ssoRequestId, email: 'member@example.com', password: 'password-one' },
      alert: false,
    })
  })

  it.each(['server rejection', 'network failure'])('keeps the existing session when account-switch logout has a %s', async failure => {
    const user = userEvent.setup()
    window.localStorage.setItem(AUTH_TOKEN_KEY, 'old-token')
    post.mockImplementation((path: string) => path === '/auth/login'
      ? Promise.resolve({ data: { token: 'new-token' } })
      : failure === 'network failure'
        ? Promise.reject(new Error('offline'))
        : Promise.reject(new ExAxiosError('http', 'SERVICE_UNAVAILABLE', 'Could not revoke', { status: 503 })))
    render(<MemoryRouter><AuthFlow presentation="page" /></MemoryRouter>)
    await user.type(screen.getByLabelText('邮箱'), 'member@example.com')
    await user.type(screen.getByLabelText('密码', { exact: true }), 'password-one')
    await user.click(screen.getByRole('button', { name: '继续' }))
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(post).toHaveBeenCalledWith('/auth/logout', { headers: { Authorization: 'Bearer old-token' }, alert: false })
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBe('old-token')
    expect(await screen.findByText(/旧账号退出失败/)).toBeTruthy()
  })

  it('stores a new account token only after the old session has been revoked', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(AUTH_TOKEN_KEY, 'old-token')
    let completeLogout: ((value: unknown) => void) | undefined
    post.mockImplementation((path: string) => path === '/auth/login'
      ? Promise.resolve({ data: { token: 'new-token' } })
      : new Promise(resolve => { completeLogout = resolve }))
    render(<MemoryRouter><AuthFlow presentation="page" /></MemoryRouter>)
    await user.type(screen.getByLabelText('邮箱'), 'member@example.com')
    await user.type(screen.getByLabelText('密码', { exact: true }), 'password-one')
    await user.click(screen.getByRole('button', { name: '继续' }))
    await user.click(screen.getByRole('button', { name: '登录' }))
    await waitFor(() => expect(completeLogout).toBeDefined())
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBe('old-token')
    completeLogout?.({ status: 'ok' })
    await waitFor(() => expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBe('new-token'))
  })

  it('keeps a successful Website login in its OIDC challenge flow', async () => {
    const user = userEvent.setup()
    const onSessionCreated = vi.fn()
    post.mockResolvedValue({ data: { token: 'new-token' } })
    render(<MemoryRouter><AuthFlow presentation="page" onSessionCreated={onSessionCreated} /></MemoryRouter>)
    await user.type(screen.getByLabelText('邮箱'), 'member@example.com')
    await user.type(screen.getByLabelText('密码', { exact: true }), 'password-one')
    await user.click(screen.getByRole('button', { name: '继续' }))
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(onSessionCreated).toHaveBeenCalledWith('new-token')
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBe('new-token')
  })

  it.each([false, true])('accepts a new login after the old session expires (transport cleared it: %s)', async cleared => {
    const user = userEvent.setup()
    const onSessionCreated = vi.fn()
    window.localStorage.setItem(AUTH_TOKEN_KEY, 'old-token')
    post.mockImplementation(async (path: string) => {
      if (path === '/auth/login') return { data: { token: 'new-token' } }
      if (cleared) window.localStorage.removeItem(AUTH_TOKEN_KEY)
      throw new ExAxiosError('http', 'SESSION_INVALID', 'Invalid session', { status: 401 })
    })
    render(<MemoryRouter><AuthFlow presentation="page" onSessionCreated={onSessionCreated} /></MemoryRouter>)
    await user.type(screen.getByLabelText('邮箱'), 'member@example.com')
    await user.type(screen.getByLabelText('密码', { exact: true }), 'password-one')
    await user.click(screen.getByRole('button', { name: '继续' }))
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(onSessionCreated).toHaveBeenCalledWith('new-token')
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBe('new-token')
  })

  it('preserves a replacement session arriving while the old account is being revoked', async () => {
    const user = userEvent.setup()
    const onSessionCreated = vi.fn()
    window.localStorage.setItem(AUTH_TOKEN_KEY, 'old-token')
    post.mockImplementation(async (path: string) => {
      if (path === '/auth/login') return { data: { token: 'new-token' } }
      window.localStorage.setItem(AUTH_TOKEN_KEY, 'replacement-token')
      return { status: 'ok' }
    })
    render(<MemoryRouter><AuthFlow presentation="page" onSessionCreated={onSessionCreated} /></MemoryRouter>)
    await user.type(screen.getByLabelText('邮箱'), 'member@example.com')
    await user.type(screen.getByLabelText('密码', { exact: true }), 'password-one')
    await user.click(screen.getByRole('button', { name: '继续' }))
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByText(/登录状态已在其他页面更改/)).toBeTruthy()
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBe('replacement-token')
    expect(onSessionCreated).not.toHaveBeenCalled()
  })
})
