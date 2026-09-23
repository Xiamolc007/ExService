// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'

const post = vi.hoisted(() => vi.fn())
vi.mock('../api/client', () => ({ api: { POST: post } }))
vi.mock('../pages/AuthPage/AuthBackdrop', () => ({ AuthBackdrop: () => null }))

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', TestResizeObserver)
Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.body })

import { AuthFlow } from './AuthFlow'
import { AuthPage } from '../pages/AuthPage'

afterEach(() => { cleanup(); post.mockReset() })

describe('AuthFlow captcha stage', () => {
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
    post.mockResolvedValue({ error: { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } } })
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
    })
    expect(await screen.findByText('邮箱或密码错误')).toBeTruthy()

    expect(screen.queryByRole('button', { name: '返回修改资料' })).toBeNull()
  })

  it('starts registration from the captcha step and then shows the email code step', async () => {
    const user = userEvent.setup()
    post.mockResolvedValue({ data: {
      email: 'member@example.com', registrationId: 'a'.repeat(43),
      serverTime: Date.now(), resendAvailableAt: Date.now() + 60_000,
    } })
    render(<MemoryRouter><AuthFlow initialMode="register" presentation="page" /></MemoryRouter>)

    await user.type(screen.getByLabelText('邮箱'), 'member@example.com')
    await user.type(screen.getByLabelText('用户名'), '成员')
    await user.type(screen.getByLabelText('密码', { exact: true }), 'password-one')
    await user.click(screen.getByRole('button', { name: '继续' }))
    expect(post).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '注册' }))
    expect(post).toHaveBeenCalledWith('/auth/registrations', {
      body: { email: 'member@example.com', nickname: '成员', password: 'password-one' },
    })
    expect(await screen.findByRole('heading', { name: '验证邮箱' })).toBeTruthy()
  })

  it('uses the same captcha step before SSO password login', async () => {
    const user = userEvent.setup()
    window.localStorage.clear()
    const ssoRequestId = 's'.repeat(43)
    post.mockImplementation((path: string) => Promise.resolve(path === '/auth/sso/inspect'
      ? { data: { ssoRequestId, status: 'pending' } }
      : { error: { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } } }))
    render(<MemoryRouter><AuthFlow initialMode="login" presentation="page" ssoRequestId={ssoRequestId} /></MemoryRouter>)

    await screen.findByRole('button', { name: '继续' })
    await user.type(screen.getByLabelText('邮箱'), 'member@example.com')
    await user.type(screen.getByLabelText('密码', { exact: true }), 'password-one')
    await user.click(screen.getByRole('button', { name: '继续' }))
    expect(post).not.toHaveBeenCalledWith('/auth/sso/login', expect.anything())
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(post).toHaveBeenCalledWith('/auth/sso/login', {
      body: { ssoRequestId, email: 'member@example.com', password: 'password-one' },
    })
  })
})
