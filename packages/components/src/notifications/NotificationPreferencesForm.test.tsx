// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  NotificationPreferencesForm, type NotificationPreferencesDraft,
  type NotificationPreferencesFormProps,
} from '@components/src/notifications/NotificationPreferencesForm'

// ExUI 的 `Field` 用 `ResizeObserver` 做响应式排布，jsdom 不提供它。
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function props(overrides: Partial<NotificationPreferencesFormProps> = {}): NotificationPreferencesFormProps {
  return {
    active: true,
    identityEpoch: 1,
    saved: { announcement: true, personal_update: true },
    status: 'ready',
    onRetry: vi.fn(),
    saving: false,
    message: null,
    conflict: false,
    necessaryCategories: ['service_notice'],
    onSave: vi.fn(async () => undefined),
    onRefresh: vi.fn(),
    ...overrides,
  }
}

describe('NotificationPreferencesForm', () => {
  it('renders the saved optional categories as switches', () => {
    render(<NotificationPreferencesForm {...props()} />)
    expect((screen.getByRole('switch', { name: '社区动态' }) as HTMLButtonElement).getAttribute('aria-checked')).toBe('true')
    expect((screen.getByRole('switch', { name: '个人提醒' }) as HTMLButtonElement).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('当前设置已保存')).toBeTruthy()
  })

  it('keeps the necessary category visible but never writable', () => {
    render(<NotificationPreferencesForm {...props()} />)
    const necessary = screen.getByRole('switch', { name: '服务通知（必要，不可关闭）' }) as HTMLButtonElement
    expect(necessary.disabled).toBe(true)
    expect(screen.getByText(/由系统固定的必要通知，不能关闭/)).toBeTruthy()
  })

  it('reports an unsaved draft and submits only on an explicit save', async () => {
    const onSave = vi.fn(async () => undefined)
    render(<NotificationPreferencesForm {...props({ onSave })} />)
    expect(screen.getByRole('button', { name: '保存更改' })).toHaveProperty('disabled', true)
    await userEvent.click(screen.getByRole('switch', { name: '社区动态' }))
    expect(screen.getByText('有尚未保存的更改')).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '保存更改' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ announcement: false, personal_update: true }))
  })

  it('keeps the draft after a failed save so the user can retry', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('保存失败，草稿已保留。请重试。'))
    render(<NotificationPreferencesForm {...props({ onSave })} />)
    await userEvent.click(screen.getByRole('switch', { name: '社区动态' }))
    await userEvent.click(screen.getByRole('button', { name: '保存更改' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '保存失败，草稿已保留。请重试。')
    expect((screen.getByRole('switch', { name: '社区动态' }) as HTMLButtonElement)
      .getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('有尚未保存的更改')).toBeTruthy()
  })

  it('keeps the draft on a 409 and offers an explicit re-read for comparison', async () => {
    const onRefresh = vi.fn()
    render(<NotificationPreferencesForm {...props({
      conflict: true,
      message: '设置已被其他设备修改（409），草稿已保留。请核对最新版本。',
      onRefresh,
    })} />)
    await userEvent.click(screen.getByRole('switch', { name: '个人提醒' }))
    expect(screen.getByText('设置已被其他设备修改（409），草稿已保留。请核对最新版本。')).toBeTruthy()
    expect((screen.getByRole('switch', { name: '个人提醒' }) as HTMLButtonElement)
      .getAttribute('aria-checked')).toBe('false')
    await userEvent.click(screen.getByRole('button', { name: '核对最新版本（保留草稿）' }))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('keeps the draft when the 409 re-read actually replaces the server snapshot', async () => {
    // 覆盖点：「核对最新版本（保留草稿）」会换掉 `saved`，那时绝不能用服务器值覆盖草稿，
    // 否则按钮文案（保留草稿）与实际行为（丢弃草稿）互相矛盾。
    const view = render(<NotificationPreferencesForm {...props({
      conflict: true,
      message: '设置已被其他设备修改（409），草稿已保留。请核对最新版本。',
    })} />)
    await userEvent.click(screen.getByRole('switch', { name: '个人提醒' }))
    expect((screen.getByRole('switch', { name: '个人提醒' }) as HTMLButtonElement)
      .getAttribute('aria-checked')).toBe('false')

    // 另一台设备把两个类别都关掉了：服务器快照变成 {false, false}，草稿是 {true, false}。
    view.rerender(<NotificationPreferencesForm {...props({
      conflict: false,
      saved: { announcement: false, personal_update: false },
      message: '已核对最新版本，草稿仍保留。请决定是否保存。',
    })} />)

    await waitFor(() => expect(screen.getByText('已核对最新版本，草稿仍保留。请决定是否保存。')).toBeTruthy())
    expect((screen.getByRole('switch', { name: '社区动态' }) as HTMLButtonElement)
      .getAttribute('aria-checked')).toBe('true')
    expect((screen.getByRole('switch', { name: '个人提醒' }) as HTMLButtonElement)
      .getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('有尚未保存的更改')).toBeTruthy()
  })

  it('follows the server snapshot when there is no draft to protect', async () => {
    const view = render(<NotificationPreferencesForm {...props()} />)
    // 另一台设备改了设置，本机没有未保存更改：直接跟随服务器最新值。
    view.rerender(<NotificationPreferencesForm {...props({
      saved: { announcement: false, personal_update: false },
    })} />)
    await waitFor(() => expect((screen.getByRole('switch', { name: '社区动态' }) as HTMLButtonElement)
      .getAttribute('aria-checked')).toBe('false'))
    expect((screen.getByRole('switch', { name: '个人提醒' }) as HTMLButtonElement)
      .getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('当前设置已保存')).toBeTruthy()
  })

  it('clears the dirty state after a successful save and stays clean on the follow-up snapshot', async () => {
    const view = render(<NotificationPreferencesForm {...props()} />)
    await userEvent.click(screen.getByRole('switch', { name: '社区动态' }))
    expect(screen.getByText('有尚未保存的更改')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '保存更改' }))
    await waitFor(() => expect(screen.getByText('当前设置已保存')).toBeTruthy())

    // 保存成功后父级把快照换成刚写入的值；此时不能把表单重新打回「有尚未保存的更改」。
    view.rerender(<NotificationPreferencesForm {...props({
      saved: { announcement: false, personal_update: true },
      message: '通知设置已保存。',
    })} />)
    await waitFor(() => expect(screen.getByText('通知设置已保存。')).toBeTruthy())
    expect(screen.getByText('当前设置已保存')).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存更改' })).toHaveProperty('disabled', true)
  })

  /**
   * 换号/退出：`bindNotificationsToken` 的顺序是「先清快照为 null（表单走 loading），
   * 新身份快照随后到达」。草稿必须在这个过程中被丢弃，不能带进新身份 ——
   * 否则用户一点「保存更改」就会把上一个账号从未选择过的偏好 PUT 到新身份。
   */
  async function switchIdentity(from: { saved: NotificationPreferencesDraft; draft: NotificationPreferencesDraft },
    to: NotificationPreferencesDraft) {
    const view = render(<NotificationPreferencesForm {...props({ saved: from.saved })} />)
    for (const [name, expected] of [['社区动态', from.draft.announcement],
      ['个人提醒', from.draft.personal_update]] as const) {
      const checked = (screen.getByRole('switch', { name }) as HTMLButtonElement)
        .getAttribute('aria-checked') === 'true'
      if (checked !== expected) await userEvent.click(screen.getByRole('switch', { name }))
    }
    expect(screen.getByText('有尚未保存的更改')).toBeTruthy()

    // 第一步：身份代次递增 + 快照清空。
    view.rerender(<NotificationPreferencesForm {...props({
      identityEpoch: 2, saved: null, status: 'loading',
    })} />)
    // 第二步：新身份的快照到达（可能与旧对账快照同值，也可能不同）。
    view.rerender(<NotificationPreferencesForm {...props({ identityEpoch: 2, saved: to })} />)
  }

  it('drops the previous identity draft on an account switch to different values', async () => {
    await switchIdentity(
      { saved: { announcement: true, personal_update: true }, draft: { announcement: false, personal_update: true } },
      { announcement: false, personal_update: false },
    )
    await waitFor(() => expect(screen.getByText('当前设置已保存')).toBeTruthy())
    expect((screen.getByRole('switch', { name: '社区动态' }) as HTMLButtonElement)
      .getAttribute('aria-checked')).toBe('false')
    // `personal_update=true` 是 A 的草稿值；B 的服务器值是 false，不能残留。
    expect((screen.getByRole('switch', { name: '个人提醒' }) as HTMLButtonElement)
      .getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('button', { name: '保存更改' })).toHaveProperty('disabled', true)
  })

  it('drops the previous identity draft even when the new identity has the old snapshot values', async () => {
    // 新身份的服务器值恰好等于旧的对账快照：若只看 savedRevision 就会漏掉这条。
    await switchIdentity(
      { saved: { announcement: true, personal_update: true }, draft: { announcement: false, personal_update: true } },
      { announcement: true, personal_update: true },
    )
    await waitFor(() => expect(screen.getByText('当前设置已保存')).toBeTruthy())
    expect((screen.getByRole('switch', { name: '社区动态' }) as HTMLButtonElement)
      .getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('button', { name: '保存更改' })).toHaveProperty('disabled', true)
  })

  it('keeps the draft when only the category changes, not the identity', async () => {
    // 对照：同一个身份内切分类不能清草稿，否则 B2 的第 1 点就白修了。
    const view = render(<NotificationPreferencesForm {...props({ identityEpoch: 1 })} />)
    await userEvent.click(screen.getByRole('switch', { name: '社区动态' }))
    expect(screen.getByText('有尚未保存的更改')).toBeTruthy()
    view.rerender(<NotificationPreferencesForm {...props({ identityEpoch: 1, active: false })} />)
    view.rerender(<NotificationPreferencesForm {...props({ identityEpoch: 1 })} />)
    expect((screen.getByRole('switch', { name: '社区动态' }) as HTMLButtonElement)
      .getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('有尚未保存的更改')).toBeTruthy()
  })

  it('restores the saved value when the draft is cancelled', async () => {
    render(<NotificationPreferencesForm {...props()} />)
    await userEvent.click(screen.getByRole('switch', { name: '社区动态' }))
    expect(screen.getByText('有尚未保存的更改')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '取消更改' }))
    expect((screen.getByRole('switch', { name: '社区动态' }) as HTMLButtonElement)
      .getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('更改已取消。')).toBeTruthy()
  })

  it('shows its own loading and failure states without touching the profile gate', async () => {
    const onRetry = vi.fn()
    render(<NotificationPreferencesForm {...props({ status: 'loading', saved: null, onRetry })} />)
    expect(screen.getByLabelText('正在加载通知设置')).toBeTruthy()
    cleanup()

    render(<NotificationPreferencesForm {...props({ status: 'error', saved: null, onRetry })} />)
    expect(screen.getByText('通知设置暂时无法读取。其他设置仍可使用。')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '重试通知设置' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('keeps the form mounted but renders nothing while another category is shown', () => {
    const { container } = render(<NotificationPreferencesForm {...props({ active: false })} />)
    expect(container.textContent).toBe('')
  })

  it('disables both save actions while a save is in flight', () => {
    render(<NotificationPreferencesForm {...props({ saving: true })} />)
    expect(screen.getByRole('button', { name: '保存中…' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('switch', { name: '社区动态' })).toHaveProperty('disabled', true)
  })
})
