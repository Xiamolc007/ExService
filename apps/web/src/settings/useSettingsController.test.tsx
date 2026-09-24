// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeToken } from '../auth/storage'
import { bindSettingsToken, settingsConfig } from './settingsConfig'

const get = vi.hoisted(() => vi.fn())
const patch = vi.hoisted(() => vi.fn())
const post = vi.hoisted(() => vi.fn())
const refreshProfile = vi.hoisted(() => vi.fn(async () => undefined))
const invalidateSession = vi.hoisted(() => vi.fn())
const logout = vi.hoisted(() => vi.fn())
const authState = vi.hoisted(() => ({ current: { status: 'authenticated', message: '' } }))
vi.mock('../api/client', () => ({ api: { GET: get, PATCH: patch, POST: post } }))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({
  state: authState.current, refreshProfile, invalidateSession,
  retrySession: vi.fn(), logout,
}) }))
vi.mock('@exre/exui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@exre/exui')>()),
  useTheme: () => ({ theme: 'dark', setTheme: vi.fn() }),
}))

import { useSettingsController } from './useSettingsController'

const user = { id: 'one', email: 'a@example.com', nickname: 'Alice',
  qq: '123', fivemId: null, avatarUrl: null }

afterEach(() => {
  cleanup()
  get.mockReset(); patch.mockReset(); post.mockReset()
  refreshProfile.mockClear(); invalidateSession.mockClear()
  logout.mockClear(); authState.current = { status: 'authenticated', message: '' }
  bindSettingsToken(null)
  window.localStorage.clear()
})

describe('settings controller', () => {
  it('shares the server snapshot and sends only the edited field with null clearing', async () => {
    writeToken(window.localStorage, 'first-token')
    get.mockResolvedValue({ data: user })
    patch.mockResolvedValue({ data: { ...user, qq: null } })
    const hook = renderHook(() => useSettingsController())
    await act(async () => { await hook.result.current.load() })
    expect(settingsConfig.profile.snapshot).toEqual(user)
    await act(async () => { await hook.result.current.save('qq', '') })
    expect(patch).toHaveBeenCalledWith('/auth/me', {
      headers: { Authorization: 'Bearer first-token' }, body: { qq: null },
    })
    expect(settingsConfig.profile.snapshot?.qq).toBeNull()
    expect(refreshProfile).toHaveBeenCalledOnce()
  })

  it('discards a late read after the account token changes', async () => {
    writeToken(window.localStorage, 'old-token')
    let release!: (value: unknown) => void
    get.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const hook = renderHook(() => useSettingsController())
    let pending!: Promise<void>
    act(() => { pending = hook.result.current.load() })
    writeToken(window.localStorage, 'new-token')
    act(() => bindSettingsToken('new-token'))
    await act(async () => { release({ data: user }); await pending })
    expect(settingsConfig.profile.snapshot).toBeNull()
    expect(settingsConfig.profile.status).toBe('idle')
  })

  it('keeps a shared read alive while the page still consumes settings', async () => {
    writeToken(window.localStorage, 'shared-token')
    let release!: (value: unknown) => void
    get.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const page = renderHook(() => useSettingsController())
    const modal = renderHook(() => useSettingsController())
    let pending!: Promise<void>
    act(() => { pending = page.result.current.load() })
    modal.unmount()
    await act(async () => { release({ data: user }); await pending })
    expect(settingsConfig.profile.snapshot).toEqual(user)
    page.unmount()
  })

  it('ignores a late read after the final settings container closes', async () => {
    writeToken(window.localStorage, 'closed-token')
    let release!: (value: unknown) => void
    get.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const hook = renderHook(() => useSettingsController())
    let pending!: Promise<void>
    act(() => { pending = hook.result.current.load() })
    hook.unmount()
    await act(async () => { release({ data: user }); await pending })
    expect(settingsConfig.profile.snapshot).toBeNull()
    expect(settingsConfig.profile.status).toBe('idle')
  })

  it('invalidates only the matching session on a rejected write', async () => {
    writeToken(window.localStorage, 'expired-token')
    get.mockResolvedValue({ data: user })
    patch.mockResolvedValue({ error: { error: { code: 'SESSION_INVALID', message: '会话已失效' } } })
    const hook = renderHook(() => useSettingsController())
    await act(async () => { await hook.result.current.load() })
    await expect(act(async () => { await hook.result.current.save('nickname', 'New') })).rejects.toThrow('会话已失效')
    expect(invalidateSession).toHaveBeenCalledWith('expired-token')
    expect(settingsConfig.profile.snapshot).toBeNull()
  })

  it('releases the logout action and exposes the auth error when logout fails', async () => {
    writeToken(window.localStorage, 'logout-token')
    const hook = renderHook(() => useSettingsController())
    act(() => hook.result.current.logout())
    expect(logout).toHaveBeenCalledOnce()
    expect(hook.result.current.logoutPending).toBe(true)
    authState.current = { status: 'unavailable', message: '退出失败，请稍后重试' }
    hook.rerender()
    await waitFor(() => expect(hook.result.current.logoutPending).toBe(false))
    expect(hook.result.current.authMessage).toBe('退出失败，请稍后重试')
  })
})
