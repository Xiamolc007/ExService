// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { SiteHeader } from '@components/src/SiteHeader'
import type { AuthAreaProps } from '@components/src/AuthArea'

function LocationPath() {
  return <output data-testid="path">{useLocation().pathname}</output>
}

function renderHeader(state: AuthAreaProps['state'], glassAtTop = false) {
  const onLogin = vi.fn()
  const onProfile = vi.fn()
  const onSettings = vi.fn()
  render(<MemoryRouter initialEntries={['/']}>
    <SiteHeader glassAtTop={glassAtTop} auth={{ state, onLogin, onRegister: vi.fn(), onRetry: vi.fn(),
      onLogout: vi.fn(), onProfile, onSettings }} />
    <LocationPath />
  </MemoryRouter>)
  return { onLogin, onProfile, onSettings }
}

afterEach(cleanup)

it('uses glass after scrolling and clears it when returning to the top', () => {
  vi.stubGlobal('scrollY', 0)
  try {
    renderHeader({ status: 'anonymous' })
    const header = screen.getByRole('banner')
    expect(header.classList.contains('ex-glass')).toBe(false)
    vi.stubGlobal('scrollY', 120)
    fireEvent.scroll(window)
    expect(header.classList.contains('ex-glass')).toBe(true)
    vi.stubGlobal('scrollY', 0)
    fireEvent.scroll(window)
    expect(header.classList.contains('ex-glass')).toBe(false)
  } finally { vi.unstubAllGlobals() }
})

it('uses glass immediately when mounted on an already scrolled page', () => {
  vi.stubGlobal('scrollY', 120)
  try {
    renderHeader({ status: 'anonymous' })
    expect(screen.getByRole('banner').classList.contains('ex-glass')).toBe(true)
  } finally { vi.unstubAllGlobals() }
})

it('keeps glass at the top when the page requests it', () => {
  vi.stubGlobal('scrollY', 0)
  try {
    renderHeader({ status: 'anonymous' }, true)
    const header = screen.getByRole('banner')
    expect(header.classList.contains('ex-glass')).toBe(true)
    vi.stubGlobal('scrollY', 120)
    fireEvent.scroll(window)
    vi.stubGlobal('scrollY', 0)
    fireEvent.scroll(window)
    expect(header.classList.contains('ex-glass')).toBe(true)
  } finally { vi.unstubAllGlobals() }
})

describe('SiteHeader Communities menu', () => {
  it('opens both community routes from the desktop dropdown', async () => {
    renderHeader({ status: 'anonymous' })

    await userEvent.hover(screen.getByRole('button', { name: 'Communities' }))
    expect((await screen.findByRole('link', { name: 'Rifling 911' })).getAttribute('href')).toBe('/communities/rifling-911')
    expect(screen.getByRole('link', { name: 'CAEP' }).getAttribute('href')).toBe('/communities/caep')

    await userEvent.click(screen.getByRole('link', { name: 'Rifling 911' }))
    expect(screen.getByTestId('path').textContent).toBe('/communities/rifling-911')
  })
})

describe('SiteHeader Join menu', () => {
  it('only offers Rifling 911 and keeps the Join page reachable', async () => {
    renderHeader({ status: 'anonymous' })

    await userEvent.hover(screen.getByRole('button', { name: 'Join' }))
    expect((await screen.findByRole('link', { name: 'Rifling 911' })).getAttribute('href')).toBe('/join/rifling-911')
    expect(screen.queryByRole('link', { name: 'CAEP' })).toBeNull()

    await userEvent.click(screen.getByRole('link', { name: 'Rifling 911' }))
    expect(screen.getByTestId('path').textContent).toBe('/join/rifling-911')
  })
})

it('links the desktop Document entry to the gateway docs path with a native anchor', () => {
  renderHeader({ status: 'anonymous' })
  const link = screen.getByRole('link', { name: 'Document' })
  expect(link.tagName).toBe('A')
  expect(link.getAttribute('href')).toBe('/docs/')
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
      expect(screen.getByRole('option', { name: 'Rifling 911' })).toBeTruthy()
      expect(screen.getByRole('option', { name: 'CAEP' })).toBeTruthy()
      expect(screen.getByRole('option', { name: 'Gallery' })).toBeTruthy()
      expect(screen.getByRole('option', { name: 'Document' })).toBeTruthy()
      expect(screen.getByRole('option', { name: 'Join' })).toBeTruthy()
      expect(screen.queryByRole('option', { name: '登录' })).toBeNull()
      await userEvent.click(screen.getByRole('option', { name: 'CAEP' }))
      expect(screen.getByTestId('path').textContent).toBe('/communities/caep')
    } finally {
      if (originalScrollIntoView) Element.prototype.scrollIntoView = originalScrollIntoView
      else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  it('leaves the Website router when selecting Document on mobile', async () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()
    try {
      renderHeader({ status: 'anonymous' })
      const trigger = screen.getByRole('combobox', { name: '打开导航菜单' })
      trigger.focus()
      await userEvent.keyboard('[Space]')
      await userEvent.click(screen.getByRole('option', { name: 'Document' }))
      expect(screen.getByTestId('path').textContent).toBe('/')
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
