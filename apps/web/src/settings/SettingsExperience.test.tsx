// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { writeToken } from '@web/src/auth/storage'
import { bindSettingsToken } from '@web/src/settings/settingsConfig'

const get = vi.hoisted(() => vi.fn())
const invalidateSession = vi.hoisted(() => vi.fn())
const authState = vi.hoisted(() => ({ status: 'authenticated' as 'authenticated' | 'unavailable' }))
vi.mock('@web/src/api/client', () => ({ api: { GET: get } }))
vi.mock('@web/src/auth/AuthContext', () => ({ useAuth: () => ({
  state: { status: authState.status }, invalidateSession, refreshProfile: vi.fn(),
  retrySession: vi.fn(), logout: vi.fn(),
}) }))
vi.mock('@exre/exui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@exre/exui')>()),
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}))
vi.mock('@workspace/components', () => ({
  SettingsPanel: ({ category, onCategoryChange, profileStatus }: {
    category: string; onCategoryChange: (category: 'profile') => void; profileStatus: string
  }) => <div><span>{category}:{profileStatus}</span>
    <button onClick={() => onCategoryChange('profile')}>个人资料分类</button></div>,
}))

import { SettingsExperience, SettingsModal } from '@web/src/settings/SettingsExperience'

const user = { id: 'user', email: 'person@example.com', nickname: 'Person',
  qq: null, fivemId: null, avatarUrl: null }

afterEach(() => { cleanup(); get.mockReset(); invalidateSession.mockReset(); bindSettingsToken(null);
  window.localStorage.clear(); authState.status = 'authenticated' })

describe('SettingsExperience', () => {
  it('names the settings dialog without the extra top description', () => {
    render(<SettingsModal initialCategory="general" onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: '设置' })).toBeTruthy()
    expect(screen.queryByText('管理外观、个人资料和账号。')).toBeNull()
  })

  it('keeps first-open general settings available and refreshes a cached snapshot on reopen', async () => {
    writeToken(window.localStorage, 'current-token')
    get.mockResolvedValue(user)
    const first = render(<SettingsExperience initialCategory="general" />)
    expect(screen.getByText('general:idle')).toBeTruthy()
    expect(get).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '个人资料分类' }))
    await waitFor(() => expect(screen.getByText('profile:ready')).toBeTruthy())
    expect(get).toHaveBeenCalledTimes(1)
    first.unmount()
    render(<SettingsExperience initialCategory="general" />)
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  })

  it('loads the selected profile category when authentication recovers', async () => {
    authState.status = 'unavailable'
    writeToken(window.localStorage, 'current-token')
    get.mockResolvedValue(user)
    const view = render(<SettingsExperience initialCategory="general" />)
    await userEvent.click(screen.getByRole('button', { name: '个人资料分类' }))
    expect(get).not.toHaveBeenCalled()
    authState.status = 'authenticated'
    view.rerender(<SettingsExperience initialCategory="general" />)
    await waitFor(() => expect(screen.getByText('profile:ready')).toBeTruthy())
    expect(get).toHaveBeenCalledTimes(1)
  })
})
