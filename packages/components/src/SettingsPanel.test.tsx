// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPanel, type SettingsPanelProps } from './SettingsPanel'

const cropperCallbacks = vi.hoisted(() => ({ current: null as import('react-easy-crop').CropperProps | null }))
vi.mock('react-easy-crop', () => ({
  default: (callbacks: import('react-easy-crop').CropperProps) => {
    cropperCallbacks.current = callbacks
    return <div data-testid="cropper" />
  },
}))

const profile = { email: 'person@example.com', nickname: 'Person', qq: '123',
  fivemId: 'fivem:42', avatarUrl: null }

function props(overrides: Partial<SettingsPanelProps> = {}): SettingsPanelProps {
  return {
    category: 'general', onCategoryChange: vi.fn(), theme: 'system', onThemeChange: vi.fn(),
    profile, profileStatus: 'ready', profileError: null, onRetry: vi.fn(),
    onSave: vi.fn(async () => undefined), onUpload: vi.fn(async () => undefined),
    onRemoveAvatar: vi.fn(async () => undefined), onLogout: vi.fn(),
    logoutPending: false, actionPending: false, ...overrides,
  }
}

afterEach(() => { cleanup(); cropperCallbacks.current = null })

describe('SettingsPanel', () => {
  it('shows mutually exclusive theme choices without waiting for profile data', async () => {
    const onThemeChange = vi.fn()
    render(<SettingsPanel {...props({ profile: null, profileStatus: 'loading', onThemeChange })} />)
    expect(screen.getByRole('radio', { name: '跟随系统' }).getAttribute('aria-checked')).toBe('true')
    await userEvent.click(screen.getByRole('radio', { name: '深色' }))
    expect(onThemeChange).toHaveBeenCalledWith('dark')
  })

  it('labels a hand-entered FiveM ID as unverified and keeps email read-only', () => {
    render(<SettingsPanel {...props({ category: 'account' })} />)
    expect(screen.getByText('person@example.com')).toBeTruthy()
    expect(screen.getByText(/未验证。此信息由用户手填/)).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: '登录邮箱' })).toBeNull()
  })

  it('keeps logout available for retry after an auth failure', async () => {
    const onLogout = vi.fn()
    const onRetryAuth = vi.fn()
    render(<SettingsPanel {...props({ category: 'account', authMessage: '退出失败，请稍后重试',
      onLogout, onRetryAuth })} />)
    expect(screen.getByRole('alert').textContent).toContain('退出失败，请稍后重试')
    await userEvent.click(screen.getByRole('button', { name: '退出登录' }))
    await userEvent.click(screen.getByRole('button', { name: '重试登录状态' }))
    expect(onLogout).toHaveBeenCalledOnce()
    expect(onRetryAuth).toHaveBeenCalledOnce()
  })

  it('validates a single QQ edit and preserves the draft after a failed save', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('保存失败')).mockResolvedValueOnce(undefined)
    render(<SettingsPanel {...props({ category: 'profile', onSave })} />)
    await userEvent.click(screen.getByRole('button', { name: '编辑QQ' }))
    const input = screen.getByRole('textbox', { name: 'QQ' })
    await userEvent.clear(input)
    await userEvent.type(input, 'wrong')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('QQ 须为 1 至 20 位数字')).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
    await userEvent.clear(input)
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '保存失败')
    expect(input).toHaveProperty('value', '')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
    expect(onSave).toHaveBeenCalledWith('qq', '')
  })

  it('keeps the active crop preview URL alive in StrictMode and releases it on cancel', async () => {
    const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
    const created: string[] = []
    const revoked: string[] = []
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => {
      const url = `blob:preview-${created.length + 1}`
      created.push(url)
      return url
    } })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: (url: string) => revoked.push(url) })
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    try {
      const onUpload = vi.fn()
      render(<StrictMode><SettingsPanel {...props({ category: 'profile', onUpload })} /></StrictMode>)
      const image = new File(['image'], 'avatar.png', { type: 'image/png' })
      await userEvent.upload(screen.getByLabelText('头像图片'), image)
      await userEvent.click(screen.getByRole('button', { name: '裁剪并上传' }))
      expect(await screen.findByRole('heading', { name: '裁剪头像' })).toBeTruthy()
      expect(created.length).toBeGreaterThan(0)
      expect(revoked).not.toContain(created.at(-1))
      await userEvent.click(screen.getByRole('button', { name: '取消' }))
      expect(revoked).toContain(created.at(-1))
      expect(onUpload).not.toHaveBeenCalled()
    } finally {
      if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate)
      else Reflect.deleteProperty(URL, 'createObjectURL')
      if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke)
      else Reflect.deleteProperty(URL, 'revokeObjectURL')
      vi.unstubAllGlobals()
    }
  })

  it('updates the crop zoom limit when the cropper recalculates media size on resize', async () => {
    const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:preview' })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined })
    try {
      render(<SettingsPanel {...props({ category: 'profile' })} />)
      await userEvent.upload(screen.getByLabelText('头像图片'),
        new File(['image'], 'avatar.png', { type: 'image/png' }))
      await userEvent.click(screen.getByRole('button', { name: '裁剪并上传' }))
      expect(await screen.findByTestId('cropper')).toBeTruthy()
      const callbacks = cropperCallbacks.current
      expect(callbacks?.setMediaSize).toBeTypeOf('function')
      expect(callbacks?.setCropSize).toBeTypeOf('function')
      act(() => {
        callbacks?.setMediaSize?.({ width: 160, height: 160, naturalWidth: 512, naturalHeight: 512 })
        callbacks?.setCropSize?.({ width: 320, height: 320 })
      })
      expect(screen.getByRole('slider', { name: '缩放' }).getAttribute('min')).toBe('2')
      act(() => {
        callbacks?.setMediaSize?.({ width: 320, height: 320, naturalWidth: 512, naturalHeight: 512 })
        callbacks?.setCropSize?.({ width: 320, height: 320 })
      })
      expect(screen.getByRole('slider', { name: '缩放' }).getAttribute('min')).toBe('1')
    } finally {
      if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate)
      else Reflect.deleteProperty(URL, 'createObjectURL')
      if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke)
      else Reflect.deleteProperty(URL, 'revokeObjectURL')
    }
  })
})
