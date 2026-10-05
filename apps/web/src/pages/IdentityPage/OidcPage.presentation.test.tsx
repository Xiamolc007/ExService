// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

const post = vi.hoisted(() => vi.fn())
vi.mock('@web/src/api/client', () => ({ api: { POST: post } }))
vi.mock('@web/src/pages/AuthPage/AuthBackdrop', () => ({ AuthBackdrop: () => null }))

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', TestResizeObserver)
Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.body })

import { OidcPage } from '@web/src/pages/IdentityPage/OidcPage'

afterEach(() => { cleanup(); post.mockReset(); window.localStorage.clear() })

function show() {
  return render(<MemoryRouter initialEntries={['/identity/login?login_challenge=valid-challenge']}>
    <OidcPage phase="login" />
  </MemoryRouter>)
}

describe('OIDC login presentation', () => {
  it('integrates the destination with the login intro and keeps it through the captcha step', async () => {
    const user = userEvent.setup()
    post.mockResolvedValue({ clientName: 'Docs', scopes: ['openid', 'profile', 'email'] })
    show()

    await screen.findByRole('heading', { name: '登录到 Exre' })
    expect(screen.getAllByRole('heading')).toHaveLength(1)
    expect(screen.getByText(/使用 Exre 账号，继续访问/).closest('form')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '继续登录文档服务' })).toBeNull()
    await user.type(screen.getByLabelText('邮箱'), 'member@example.com')
    await user.type(screen.getByLabelText('密码', { exact: true }), 'password-one')
    const disclosure = screen.getByRole('button', { name: '文档服务将获取哪些信息？' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('openid')).toBeNull()
    await user.click(disclosure)
    const dialog = await screen.findByRole('dialog', { name: '登录时共享的信息' })
    expect(dialog.closest('main')).toBeNull()
    expect(within(dialog).getByRole('heading', { name: '账号身份' })).toBeTruthy()
    expect(within(dialog).getByRole('heading', { name: '基本资料' })).toBeTruthy()
    expect(within(dialog).getByRole('heading', { name: '邮箱地址' })).toBeTruthy()
    expect(post).toHaveBeenCalledTimes(1)
    await user.click(within(dialog).getByRole('button', { name: '知道了' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(disclosure))
    expect((screen.getByLabelText('邮箱') as HTMLInputElement).value).toBe('member@example.com')
    expect((screen.getByLabelText('密码', { exact: true }) as HTMLInputElement).value).toBe('password-one')
    await user.click(screen.getByRole('button', { name: '继续' }))
    expect(screen.getByRole('heading', { name: '输入验证码' })).toBeTruthy()
    expect(screen.getByText(/使用 Exre 账号，继续访问/).closest('form')).toBeTruthy()
    expect(screen.getByRole('button', { name: '文档服务将获取哪些信息？' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '文档服务将获取哪些信息？' }))
    expect(await screen.findByRole('dialog', { name: '登录时共享的信息' })).toBeTruthy()
    expect(post).toHaveBeenCalledTimes(1)
  })

  it.each(['Escape', 'close button'])('closes with %s and returns focus to the information trigger', async method => {
    const user = userEvent.setup()
    post.mockResolvedValue({ clientName: 'Docs', scopes: ['openid'] })
    show()
    const trigger = await screen.findByRole('button', { name: '文档服务将获取哪些信息？' })
    await user.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: '登录时共享的信息' })
    if (method === 'Escape') await user.keyboard('{Escape}')
    else await user.click(within(dialog).getByRole('button', { name: '关闭信息说明' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('describes only the scopes returned by the inspected challenge', async () => {
    const user = userEvent.setup()
    post.mockResolvedValue({ clientName: 'Docs', scopes: ['openid'] })
    show()
    await user.click(await screen.findByRole('button', { name: '文档服务将获取哪些信息？' }))
    const dialog = await screen.findByRole('dialog', { name: '登录时共享的信息' })
    expect(within(dialog).getByRole('heading', { name: '账号身份' })).toBeTruthy()
    expect(within(dialog).queryByRole('heading', { name: '基本资料' })).toBeNull()
    expect(within(dialog).queryByRole('heading', { name: '邮箱地址' })).toBeNull()
  })

  it('keeps an unknown scope visible without inventing a permission description', async () => {
    const user = userEvent.setup()
    post.mockResolvedValue({ clientName: 'Docs', scopes: ['toString'] })
    show()
    await user.click(await screen.findByRole('button', { name: '文档服务将获取哪些信息？' }))
    const dialog = await screen.findByRole('dialog', { name: '登录时共享的信息' })
    expect(within(dialog).getByRole('heading', { name: '其他请求信息' })).toBeTruthy()
    await user.click(within(dialog).getByText('查看技术标识'))
    expect(screen.getByText('toString')).toBeTruthy()
  })
})
