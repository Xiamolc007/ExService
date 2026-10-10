// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotificationPreferencesForm, type NotificationPreferencesDraft, type NotificationPreferencesFormProps } from '@components/src/notifications/NotificationPreferencesForm'

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const initial = { announcement: true, personal_update: true }
function props(overrides: Partial<NotificationPreferencesFormProps> = {}): NotificationPreferencesFormProps {
  return { active: true, identityEpoch: 1, saved: initial, status: 'ready', onRetry: vi.fn(), saving: false,
    message: null, conflict: false,
    onSave: vi.fn(async (values: NotificationPreferencesDraft) => values), ...overrides }
}
function deferred() {
  let resolve!: (value: NotificationPreferencesDraft) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<NotificationPreferencesDraft>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}
const checked = (name: string) => screen.getByRole('switch', { name }).getAttribute('aria-checked')

describe('NotificationPreferencesForm immediate saving', () => {
  it('shows only the two optional switches, without service, necessary group or save/cancel actions', () => {
    render(<NotificationPreferencesForm {...props()} />)
    expect(screen.getAllByRole('switch')).toHaveLength(2)
    expect(screen.queryByText('服务通知')).toBeNull()
    expect(screen.queryByLabelText('必要通知')).toBeNull()
    expect(screen.queryByRole('button', { name: /保存|取消/ })).toBeNull()
    expect(screen.queryByText(/已保存/)).toBeNull()
  })
  it('saves only on a user toggle, validates both fields and adopts canonical server values', async () => {
    const onSave = vi.fn(async () => ({ announcement: true, personal_update: false }))
    render(<NotificationPreferencesForm {...props({ onSave })} />)
    expect(onSave).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('switch', { name: '社区动态' }))
    expect(onSave).toHaveBeenCalledWith({ announcement: false, personal_update: true })
    expect(checked('社区动态')).toBe('true')
    expect(checked('个人提醒')).toBe('false')
    expect(screen.queryByText(/已保存/)).toBeNull()
  })
  it('locks both switches synchronously for rapid toggles while saving', async () => {
    const pending = deferred(), onSave = vi.fn(() => pending.promise)
    render(<NotificationPreferencesForm {...props({ onSave })} />)
    act(() => { fireEvent.click(screen.getByRole('switch', { name: '社区动态' })); fireEvent.click(screen.getByRole('switch', { name: '个人提醒' })) })
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(screen.getAllByRole('switch').every(element => (element as HTMLButtonElement).disabled)).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('保存中…')
    await act(async () => { pending.resolve({ announcement: false, personal_update: true }) })
    expect(screen.queryByRole('status')).toBeNull()
  })
  it('rolls back on failure and retries only the failed field against the latest confirmed other value', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('secret backend message'))
      .mockImplementationOnce(async (value: NotificationPreferencesDraft) => value)
    const input = props({ onSave }), view = render(<NotificationPreferencesForm {...input} />)
    await userEvent.click(screen.getByRole('switch', { name: '社区动态' }))
    expect(checked('社区动态')).toBe('true')
    expect(screen.getByRole('alert').textContent).toContain('保存失败，已恢复上次设置。请重试。')
    expect(screen.queryByText(/secret/)).toBeNull()
    view.rerender(<NotificationPreferencesForm {...input} saved={{ announcement: true, personal_update: false }} />)
    await userEvent.click(screen.getByRole('button', { name: '重试保存' }))
    expect(onSave.mock.calls[1]?.[0]).toEqual({ announcement: false, personal_update: false })
    expect(checked('个人提醒')).toBe('false')
  })
  it('follows latest confirmed props and category switches without automatic writes', async () => {
    const input = props(), view = render(<NotificationPreferencesForm {...input} />)
    view.rerender(<NotificationPreferencesForm {...input} active={false} saved={{ announcement: false, personal_update: false }} />)
    view.rerender(<NotificationPreferencesForm {...input} saved={{ announcement: false, personal_update: false }} />)
    expect(checked('社区动态')).toBe('false')
    expect(input.onSave).not.toHaveBeenCalled()
  })
  it.each(['success', 'failure'] as const)('ignores old account %s and finally while a new account save is pending', async outcome => {
    const old = deferred(), next = deferred(), onSave = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    const input = props({ onSave }), view = render(<NotificationPreferencesForm {...input} />)
    await userEvent.click(screen.getByRole('switch', { name: '社区动态' }))
    view.rerender(<NotificationPreferencesForm {...input} identityEpoch={2} saved={{ announcement: true, personal_update: false }} />)
    await userEvent.click(screen.getByRole('switch', { name: '个人提醒' }))
    await act(async () => { if (outcome === 'success') old.resolve({ announcement: false, personal_update: true }); else old.reject(new Error('old account secret')) })
    expect(screen.getByRole('status').textContent).toBe('保存中…')
    expect(checked('社区动态')).toBe('true')
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => { next.resolve({ announcement: true, personal_update: true }) })
    expect(checked('个人提醒')).toBe('true')
  })
  it('drops old completion after unmount', async () => {
    const pending = deferred(), input = props({ onSave: vi.fn(() => pending.promise) })
    const view = render(<NotificationPreferencesForm {...input} />)
    await userEvent.click(screen.getByRole('switch', { name: '社区动态' }))
    view.unmount()
    await act(async () => { pending.resolve({ announcement: false, personal_update: false }) })
    render(<NotificationPreferencesForm {...props()} />)
    expect(checked('社区动态')).toBe('true')
  })
  it('renders refreshed conflict values and asks for a new adjustment without a blind save retry', () => {
    render(<NotificationPreferencesForm {...props({ saved: { announcement: false, personal_update: false }, conflict: true,
      message: '设置已由其他设备更新，请重新调整。' })} />)
    expect(checked('社区动态')).toBe('false')
    expect(screen.getByText('设置已由其他设备更新，请重新调整。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '重试保存' })).toBeNull()
  })
  it('renders independent loading and read-error retry', async () => {
    const input = props({ status: 'loading', saved: null }), view = render(<NotificationPreferencesForm {...input} />)
    expect(screen.getByLabelText('正在加载通知设置')).toBeTruthy()
    view.rerender(<NotificationPreferencesForm {...input} status="error" />)
    await userEvent.click(screen.getByRole('button', { name: '重试通知设置' }))
    expect(input.onRetry).toHaveBeenCalledOnce()
  })
})
