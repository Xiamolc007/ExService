// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeToken } from '@web/src/auth/storage'
import { bindNotificationsToken, captureNotificationWrite, notificationsConfig } from '@web/src/notifications/notificationsConfig'
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
  it('settles an already-sent PUT into a surviving owner after its original owner exits', async () => {
    get.mockResolvedValue(stored)
    const writer = renderHook(() => useNotificationPreferencesController()), surviving = renderHook(() => useNotificationPreferencesController())
    await act(async () => { await writer.result.current.load() })
    const pending = deferred()
    put.mockReturnValue(pending.promise)
    let task!: Promise<unknown>
    act(() => { task = writer.result.current.save({ announcement: false, personal_update: true }).catch(() => null) })
    await act(async () => { writer.unmount() })
    expect(surviving.result.current.slice.saving).toBe(true)
    const ignored = surviving.result.current.save({ announcement: true, personal_update: true }).then(() => false, () => true)
    expect(put).toHaveBeenCalledTimes(1)
    expect(await ignored).toBe(true)
    await act(async () => { pending.resolve({ ...stored, revision: 4, optionalCategories: { announcement: false, personal_update: true } }); await task })
    expect(surviving.result.current.slice).toMatchObject({ saving: false, preferences: { announcement: false, personal_update: true }, message: null })
    expect(notificationsConfig.preferences.snapshot?.revision).toBe(4)
  })
  it('re-reads a detached PUT conflict for the surviving owner without submitting again', async () => {
    get.mockResolvedValueOnce(stored).mockResolvedValueOnce({ ...stored, revision: 8, optionalCategories: { announcement: false, personal_update: false } })
    const writer = renderHook(() => useNotificationPreferencesController()), surviving = renderHook(() => useNotificationPreferencesController())
    await act(async () => { await writer.result.current.load() })
    const pending = deferred()
    put.mockReturnValue(pending.promise)
    let task!: Promise<unknown>
    act(() => { task = writer.result.current.save({ announcement: false, personal_update: true }).catch(() => null) })
    writer.unmount()
    await act(async () => { pending.reject(new ExAxiosError('http', 'PREFERENCES_CONFLICT', 'private conflict', { status: 409 })); await task })
    expect(get).toHaveBeenCalledTimes(2)
    expect(put).toHaveBeenCalledTimes(1)
    expect(surviving.result.current.slice).toMatchObject({ status: 'ready', saving: false, conflict: true,
      preferences: { announcement: false, personal_update: false } })
    expect(notificationsConfig.preferences.snapshot?.revision).toBe(8)
  })
  it('leaves a retryable read error when detached conflict reconciliation fails', async () => {
    get.mockResolvedValueOnce(stored).mockRejectedValueOnce(new Error('private reconciliation failure'))
      .mockResolvedValueOnce({ ...stored, revision: 8 })
    const writer = renderHook(() => useNotificationPreferencesController()), surviving = renderHook(() => useNotificationPreferencesController())
    await act(async () => { await writer.result.current.load() })
    const pending = deferred()
    put.mockReturnValue(pending.promise)
    let task!: Promise<unknown>
    act(() => { task = writer.result.current.save({ announcement: false, personal_update: true }).catch(() => null) })
    writer.unmount()
    await act(async () => { pending.reject(new ExAxiosError('http', 'PREFERENCES_CONFLICT', 'private conflict', { status: 409 })); await task })
    expect(surviving.result.current.slice).toMatchObject({ status: 'error', saving: false })
    expect(notificationsConfig.preferences.error).toBe('通知设置暂时无法读取')
    await act(async () => { surviving.result.current.slice.onRetry() })
    expect(surviving.result.current.slice.status).toBe('ready')
    expect(notificationsConfig.preferences.snapshot?.revision).toBe(8)
    expect(put).toHaveBeenCalledTimes(1)
  })
  it.each(['success', 'error'] as const)('restores a surviving ready owner when the latest GET owner unmounts before %s', async outcome => {
    get.mockResolvedValue(stored)
    const surviving = renderHook(() => useNotificationPreferencesController())
    await act(async () => { await surviving.result.current.load() })
    const temporary = renderHook(() => useNotificationPreferencesController()), pending = deferred()
    get.mockReturnValueOnce(pending.promise)
    let task!: Promise<void>
    await act(async () => { task = temporary.result.current.load() })
    expect(surviving.result.current.slice.status).toBe('loading')
    await act(async () => { temporary.unmount() })
    expect(surviving.result.current.slice.status).toBe('ready')
    await act(async () => { if (outcome === 'success') pending.resolve({ ...stored, revision: 99 }); else pending.reject(new Error('closed modal error')); await task })
    expect(surviving.result.current.slice).toMatchObject({ status: 'ready', preferences: stored.optionalCategories })
    expect(notificationsConfig.preferences.snapshot?.revision).toBe(3)
  })
  it('keeps a surviving reader and shared PUT acceptance alive after the save owner unmounts', async () => {
    get.mockResolvedValue(stored)
    const writer = renderHook(() => useNotificationPreferencesController()), reader = renderHook(() => useNotificationPreferencesController())
    await act(async () => { await writer.result.current.load() })
    const write = deferred(), read = deferred()
    put.mockReturnValue(write.promise); get.mockReturnValueOnce(read.promise)
    let save!: Promise<unknown>, load!: Promise<void>
    act(() => { save = writer.result.current.save({ announcement: false, personal_update: true }).catch(() => null); load = reader.result.current.load() })
    await act(async () => { writer.unmount() })
    expect(reader.result.current.slice).toMatchObject({ status: 'loading', saving: true })
    await act(async () => { write.resolve({ ...stored, revision: 99 }); read.resolve({ ...stored, revision: 88 }); await save; await load })
    expect(notificationsConfig.preferences.snapshot?.revision).toBe(99)
    expect(reader.result.current.slice.status).toBe('ready')
  })
  it.each([400, 500])('keeps safe failure text and confirmed values for HTTP %s', async status => {
    get.mockResolvedValue(stored)
    put.mockRejectedValue(new ExAxiosError('http', 'HTTP_ERROR', 'secret SQL credentials', { status }))
    const hook = renderHook(() => useNotificationPreferencesController())
    await act(async () => { await hook.result.current.load() })
    await expect(act(async () => { await hook.result.current.save({ announcement: false, personal_update: true }) }))
      .rejects.toThrow('保存失败，已恢复上次设置。请重试。')
    expect(hook.result.current.slice.preferences).toEqual(stored.optionalCategories)
    expect(hook.result.current.slice.saving).toBe(false)
    expect(hook.result.current.slice.status).toBe('ready')
  })
  it('clears identity and releases saving when PUT reports SESSION_INVALID', async () => {
    get.mockResolvedValue(stored)
    put.mockRejectedValue(new ExAxiosError('http', 'SESSION_INVALID', 'private session details', { status: 401 }))
    const hook = renderHook(() => useNotificationPreferencesController())
    await act(async () => { await hook.result.current.load() })
    await expect(act(async () => { await hook.result.current.save({ announcement: false, personal_update: true }) }))
      .rejects.toThrow('登录状态已失效，请重新登录。')
    expect(invalidateSession).toHaveBeenCalledWith('session-token')
    expect(hook.result.current.slice).toMatchObject({ preferences: null, status: 'idle', saving: false, message: null })
  })
  it('discards a latest GET completion after its owner unmounts', async () => {
    const pending = deferred()
    get.mockReturnValue(pending.promise)
    const hook = renderHook(() => useNotificationPreferencesController())
    let task!: Promise<void>
    act(() => { task = hook.result.current.load() })
    hook.unmount()
    await act(async () => { pending.resolve(stored); await task })
    expect(notificationsConfig.preferences.snapshot).toBeNull()
  })
  it('accepts only the latest GET and remains independent from receipt write generations', async () => {
    const first = deferred(), second = deferred()
    get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const hook = renderHook(() => useNotificationPreferencesController())
    let old!: Promise<void>, latest!: Promise<void>
    act(() => { old = hook.result.current.load(); latest = hook.result.current.load() })
    act(() => { captureNotificationWrite() })
    await act(async () => { second.resolve({ ...stored, revision: 8 }); await latest })
    await act(async () => { first.resolve(stored); await old })
    expect(notificationsConfig.preferences.snapshot?.revision).toBe(8)
  })
  it('guards duplicate saves synchronously and returns the canonical server values', async () => {
    get.mockResolvedValue(stored)
    const pending = deferred()
    put.mockReturnValue(pending.promise)
    const hook = renderHook(() => useNotificationPreferencesController())
    await act(async () => { await hook.result.current.load() })
    let first!: Promise<unknown>
    act(() => { first = hook.result.current.save({ announcement: false, personal_update: true }) })
    const duplicate = hook.result.current.save({ announcement: true, personal_update: true }).then(() => false, () => true)
    expect(put).toHaveBeenCalledTimes(1)
    let canonical: unknown
    await act(async () => { pending.resolve({ ...stored, revision: 4 }); canonical = await first })
    expect(await duplicate).toBe(true)
    expect(canonical).toEqual(stored.optionalCategories)
  })
  it.each(['success', 'error'] as const)('isolates old-account save %s and finally from a new-account pending save', async outcome => {
    get.mockResolvedValue(stored)
    const old = deferred(), next = deferred()
    put.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    const hook = renderHook(() => useNotificationPreferencesController())
    await act(async () => { await hook.result.current.load() })
    let first!: Promise<unknown>
    act(() => { first = hook.result.current.save({ announcement: false, personal_update: false }).catch(() => null) })
    await act(async () => { writeToken(window.localStorage, 'other-token'); bindNotificationsToken('other-token'); await hook.result.current.load() })
    let second!: Promise<unknown>
    act(() => { second = hook.result.current.save({ announcement: true, personal_update: true }) })
    await act(async () => { if (outcome === 'success') old.resolve({ ...stored, revision: 99 }); else old.reject(new Error('old private error')); await first })
    expect(hook.result.current.slice.saving).toBe(true)
    expect(notificationsConfig.preferences.snapshot?.revision).toBe(3)
    await act(async () => { next.resolve({ ...stored, revision: 4 }); await second })
    expect(hook.result.current.slice.saving).toBe(false)
    expect(notificationsConfig.preferences.snapshot?.revision).toBe(4)
  })
  it('does not save for an anonymous user even if a previous snapshot is present', async () => {
    authState.status = 'anonymous'
    notificationsConfig.preferences.snapshot = stored as typeof notificationsConfig.preferences.snapshot
    put.mockResolvedValue(stored)
    const hook = renderHook(() => useNotificationPreferencesController())
    await expect(hook.result.current.save(stored.optionalCategories)).rejects.toThrow()
    expect(put).not.toHaveBeenCalled()
  })
  it('shares the save lock and invalidates another mounted owner’s older GET', async () => {
    get.mockResolvedValue(stored)
    const firstOwner = renderHook(() => useNotificationPreferencesController())
    const secondOwner = renderHook(() => useNotificationPreferencesController())
    await act(async () => { await firstOwner.result.current.load() })
    const oldRead = deferred(), write = deferred()
    get.mockReturnValueOnce(oldRead.promise)
    put.mockReturnValue(write.promise)
    let read!: Promise<void>, save!: Promise<unknown>
    act(() => { read = firstOwner.result.current.load(); save = secondOwner.result.current.save({ announcement: false, personal_update: true }) })
    const duplicate = firstOwner.result.current.save({ announcement: true, personal_update: true }).then(() => false, () => true)
    expect(put).toHaveBeenCalledTimes(1)
    await act(async () => { write.resolve({ ...stored, revision: 4, optionalCategories: { announcement: false, personal_update: true } }); await save })
    expect(await duplicate).toBe(true)
    await act(async () => { oldRead.resolve(stored); await read })
    expect(firstOwner.result.current.slice.preferences).toEqual({ announcement: false, personal_update: true })
  })
  it('discards a GET begun during PUT when it returns after canonical save success', async () => {
    get.mockResolvedValue(stored)
    const hook = renderHook(() => useNotificationPreferencesController())
    await act(async () => { await hook.result.current.load() })
    const write = deferred(), oldRead = deferred()
    put.mockReturnValue(write.promise); get.mockReturnValueOnce(oldRead.promise)
    let save!: Promise<unknown>, read!: Promise<void>
    act(() => { save = hook.result.current.save({ announcement: false, personal_update: true }); read = hook.result.current.load() })
    await act(async () => { write.resolve({ ...stored, revision: 8 }); await save })
    await act(async () => { oldRead.resolve(stored); await read })
    expect(notificationsConfig.preferences.snapshot?.revision).toBe(8)
  })
  it('settles shared canonical values after owner unmount without showing success feedback', async () => {
    get.mockResolvedValue(stored)
    const pending = deferred()
    put.mockReturnValue(pending.promise)
    const hook = renderHook(() => useNotificationPreferencesController())
    await act(async () => { await hook.result.current.load() })
    let task!: Promise<unknown>
    act(() => { task = hook.result.current.save({ announcement: false, personal_update: true }).catch(() => null) })
    hook.unmount()
    await act(async () => { pending.resolve({ ...stored, revision: 99 }); await task })
    expect(notificationsConfig.preferences.snapshot?.revision).toBe(99)
    expect(notificationsConfig.preferences.message).not.toBe('通知设置已保存。')
  })
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
    expect(hook.result.current.slice.message).toBeNull()
    hook.unmount()
  })

  it('re-reads canonical server values on a 409 instead of retaining a draft or overwriting', async () => {
    get.mockResolvedValueOnce(stored).mockResolvedValueOnce({ ...stored, revision: 8,
      optionalCategories: { announcement: false, personal_update: false } })
    put.mockRejectedValue(new ExAxiosError('http', 'PREFERENCES_CONFLICT', '设置已被其他设备修改', { status: 409 }))
    const hook = renderHook(() => useNotificationPreferencesController())
    await act(async () => { await hook.result.current.load() })
    await expect(act(async () => {
      await hook.result.current.save({ announcement: false, personal_update: true })
    })).rejects.toThrow('设置已由其他设备更新，请重新调整。')
    expect(hook.result.current.slice.conflict).toBe(true)
    expect(hook.result.current.slice.message)
      .toBe('设置已由其他设备更新，请重新调整。')
    expect(hook.result.current.slice.preferences).toEqual({ announcement: false, personal_update: false })
    expect(notificationsConfig.preferences.snapshot?.revision).toBe(8)
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
    expect(hook.result.current.slice.message).toBeNull()
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

function deferred() {
  let resolve!: (value: unknown) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<unknown>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}
