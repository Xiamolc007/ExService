// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { SiteHeader } from './SiteHeader'
import type { AuthAreaProps } from './AuthArea'

function LocationPath() {
  return <output data-testid="path">{useLocation().pathname}</output>
}

function renderHeader(state: AuthAreaProps['state']) {
  const onLogin = vi.fn()
  const onProfile = vi.fn()
  const onSettings = vi.fn()
  render(<MemoryRouter initialEntries={['/']}>
    <SiteHeader auth={{ state, onLogin, onRegister: vi.fn(), onRetry: vi.fn(),
      onLogout: vi.fn(), onProfile, onSettings }} />
    <LocationPath />
  </MemoryRouter>)
  return { onLogin, onProfile, onSettings }
}

afterEach(cleanup)

describe('SiteHeader Join menu', () => {
  it('reveals both projects on hover and keeps the Join page reachable', async () => {
    renderHeader({ status: 'anonymous' })

    await userEvent.hover(screen.getByRole('button', { name: 'Join' }))
    expect(await screen.findByRole('link', { name: 'CAEP' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Rifling 911' })).toBeTruthy()

    await userEvent.click(screen.getByRole('link', { name: 'CAEP' }))
    expect(screen.getByTestId('path').textContent).toBe('/join')
  })
})

describe('SiteHeader mobile navigation', () => {
  it('opens a Select with the existing navigation targets and navigates within the router', async () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()
    try {
      renderHeader({ status: 'anonymous' })
      const trigger = screen.getByRole('combobox', { name: '打开导航菜单' })
      trigger.focus()
      await userEvent.keyboard('[Space]')
      expect(screen.getByRole('option', { name: 'Dispatch' })).toBeTruthy()
      expect(screen.getByRole('option', { name: 'Gallery' })).toBeTruthy()
      expect(screen.getByRole('option', { name: 'Join' })).toBeTruthy()
      expect(screen.queryByRole('option', { name: '登录' })).toBeNull()
      await userEvent.keyboard('[ArrowDown][ArrowDown][Enter]')
      expect(screen.getByTestId('path').textContent).toBe('/gallery')
    } finally {
      if (originalScrollIntoView) Element.prototype.scrollIntoView = originalScrollIntoView
      else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  it('opens account actions from the separate right-hand Select', async () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()
    try {
      const { onLogin } = renderHeader({ status: 'anonymous' })
      const trigger = screen.getByRole('combobox', { name: '用户菜单' })
      trigger.focus()
      await userEvent.keyboard('[Space]')
      expect(screen.queryByRole('option', { name: 'Gallery' })).toBeNull()
      await userEvent.click(screen.getByRole('option', { name: '登录' }))
      expect(onLogin).toHaveBeenCalledOnce()
    } finally {
      if (originalScrollIntoView) Element.prototype.scrollIntoView = originalScrollIntoView
      else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  it('shows the avatar and personal actions in the mobile account Select', async () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()
    try {
      const { onProfile, onSettings } = renderHeader({ status: 'authenticated',
        nickname: 'Alice', initial: 'A', avatarUrl: '/avatar.png' })
      const trigger = screen.getByRole('combobox', { name: '用户菜单' })
      expect(trigger.querySelector('[data-slot="avatar"]')).toBeTruthy()
      trigger.focus()
      await userEvent.keyboard('[Space]')
      expect(screen.getByRole('option', { name: '个人资料' })).toBeTruthy()
      expect(screen.getByRole('option', { name: '设置' })).toBeTruthy()
      expect(screen.getByRole('option', { name: '退出登录' })).toBeTruthy()
      await userEvent.click(screen.getByRole('option', { name: '个人资料' }))
      expect(onProfile).toHaveBeenCalledOnce()
      expect(onSettings).not.toHaveBeenCalled()
    } finally {
      if (originalScrollIntoView) Element.prototype.scrollIntoView = originalScrollIntoView
      else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })
})
