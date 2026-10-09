// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeToken } from '@web/src/auth/storage'
import { bindNotificationsToken, notificationsConfig } from '@web/src/notifications/notificationsConfig'
import { ExAxiosError } from '@workspace/sdk/http/browser'

const get = vi.hoisted(() => vi.fn())
const put = vi.hoisted(() => vi.fn())
const invalidateSession = vi.hoisted(() => vi.fn())
const authState = vi.hoisted(() => ({ status: 'authenticated' as 'authenticated' | 'anonymous' }))
vi.mock('@web/src/api/client', () => ({ api: { GET: get, PUT: put } }))
vi.mock('@web/src/auth/AuthContext', () => ({ useAuth: () => ({
  state: { status: authState.status }, invalidateSession, refreshProfile: vi.fn(),
  retrySession: vi.fn(), logout: vi.fn(),
}) }))

import { useNotificationPreferencesController } from '@web/src/notifications/useNotificationPreferencesController'

const stored = {
  revision: 3,
  optionalCategories: { announcement: true, personal_update: false },
  necessaryCategories: ['service_notice'],
  serverTime: 0,
}

beforeEach(() => {
  writeToken(window.localStorage, 'session-token')
  bindNotificationsToken('session-token')
})

afterEach(() => {
  cleanup()
  get.mockReset(); put.mockReset(); invalidateSession.mockClear()
  authState.status = 'authenticated'
  bindNotificationsToken(null)
  window.localStorage.clear()
})

describe('notification preferences controller', () => {
  it('reports the effective defaults and exposes the necessary categories as read-only', async () => {
    get.mockResolvedValue(stored)
    const hook = renderHook(() => useNotificationPreferencesController())
    await act(async () => { await hook.result.current.load() })
    expect(get).toHaveBeenCalledWith('/notification-preferences', { alert: false })
    expect(hook.result.current.slice.preferences)
      .toEqual({ announcement: true, personal_update: false })
    expect(hook.result.current.slice.necessaryCategories).toEqual(['service_notice'])
    hook.unmount()
  })

  it('replaces every optional category with the stored revision', async () => {
    get.mockResolvedValue(stored)
    put.mockResolvedValue({ ...stored, revision: 4, optionalCategories: { announcement: false, personal_update: false } })
    const hook = renderHook(() => useNotificationPreferencesController())
    await act(async () => { await hook.result.current.load() })
    await act(async () => {
      await hook.result.current.save({ announcement: false, personal_update: false })
    })
    expect(put).toHaveBeenCalledWith('/notification-preferences', {
      alert: false,
      body: {
        expectedRevision: 3,
        optionalCategories: { announcement: false, personal_update: false },
      },
    })
    expect(hook.result.current.slice.preferences?.announcement).toBe(false)
    expect(hook.result.current.slice.message).toBe('通知设置已保存。')
    hook.unmount()
  })

  it('keeps the draft and re-reads the server version on a 409 instead of overwriting', async () => {
    get.mockResolvedValue(stored)
    put.mockRejectedValue(new ExAxiosError('http', 'PREFERENCES_CONFLICT', '设置已被其他设备修改', { status: 409 }))
    const hook = renderHook(() => useNotificationPreferencesController())
    await act(async () => { await hook.result.current.load() })
    await expect(act(async () => {
      await hook.result.current.save({ announcement: false, personal_update: true })
    })).rejects.toThrow('设置已被其他设备修改（409）')
    expect(hook.result.current.slice.conflict).toBe(true)
    expect(hook.result.current.slice.message)
      .toBe('设置已被其他设备修改（409），草稿已保留。请核对最新版本。')
    // 只重新读取服务器版本，PUT 不被重复提交。
    expect(put).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    hook.unmount()
  })

  it('clears the conflict once the user has compared the freshly read version', async () => {
    get.mockResolvedValue(stored)
    const hook = renderHook(() => useNotificationPreferencesController())
    await act(async () => { await hook.result.current.refresh() })
    expect(hook.result.current.slice.conflict).toBe(false)
    expect(hook.result.current.slice.message).toBe('已核对最新版本，草稿仍保留。请决定是否保存。')
    hook.unmount()
  })

  it('keeps the failure inside its own slice without touching the profile store', async () => {
    get.mockRejectedValue(new ExAxiosError('http', 'HTTP_ERROR', '通知设置暂时无法读取', { status: 500 }))
    const hook = renderHook(() => useNotificationPreferencesController())
    await act(async () => { await hook.result.current.load() })
    expect(hook.result.current.slice.status).toBe('error')
    expect(notificationsConfig.preferences.error).toBe('通知设置暂时无法读取')
    hook.unmount()
  })

  it('clears the private snapshot and hands back the session on SESSION_INVALID', async () => {
    get.mockRejectedValue(new ExAxiosError('http', 'SESSION_INVALID', '会话已失效', { status: 401 }))
    const hook = renderHook(() => useNotificationPreferencesController())
    await act(async () => { await hook.result.current.load() })
    expect(invalidateSession).toHaveBeenCalledWith('session-token')
    expect(notificationsConfig.preferences.snapshot).toBeNull()
    expect(notificationsConfig.preferences.status).toBe('idle')
    hook.unmount()
  })

  it('drops a late response after the account changes', async () => {
    let release!: (value: unknown) => void
    get.mockImplementation(() => new Promise(resolve => { release = resolve }))
    const hook = renderHook(() => useNotificationPreferencesController())
    let pending!: Promise<void>
    act(() => { pending = hook.result.current.load() })
    writeToken(window.localStorage, 'other-token')
    await act(async () => { bindNotificationsToken('other-token') })
    await act(async () => { release(stored); await pending })
    expect(notificationsConfig.preferences.snapshot).toBeNull()
    expect(notificationsConfig.preferences.status).toBe('idle')
    hook.unmount()
  })

  it('advances the identity epoch handed to the form when the account changes', async () => {
    // 表单靠这个代次丢弃上一个身份的草稿；控制器必须真的把它接出来。
    get.mockResolvedValue(stored)
    const hook = renderHook(() => useNotificationPreferencesController())
    const first = hook.result.current.slice.identityEpoch
    await act(async () => { await hook.result.current.load() })
    expect(hook.result.current.slice.identityEpoch).toBe(first)

    writeToken(window.localStorage, 'other-token')
    await act(async () => { bindNotificationsToken('other-token') })
    expect(hook.result.current.slice.identityEpoch).toBeGreaterThan(first)
    // 同一 token 重复绑定不应抖动，否则每次都会清一次草稿。
    await act(async () => { bindNotificationsToken('other-token') })
    expect(hook.result.current.slice.identityEpoch).toBe(first + 1)
    hook.unmount()
  })

  it('does not read anything for an anonymous visitor', async () => {
    authState.status = 'anonymous'
    const hook = renderHook(() => useNotificationPreferencesController())
    await act(async () => { await hook.result.current.load() })
    expect(get).not.toHaveBeenCalled()
    hook.unmount()
  })
})
