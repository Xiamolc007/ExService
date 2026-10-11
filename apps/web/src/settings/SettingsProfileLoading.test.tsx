// @vitest-environment jsdom
import { StrictMode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { writeToken } from '@web/src/auth/storage'
import { bindSettingsToken } from '@web/src/settings/settingsConfig'
import { bindNotificationsToken } from '@web/src/notifications/notificationsConfig'

const get = vi.hoisted(() => vi.fn())
vi.mock('@web/src/api/client', () => ({ api: { GET: get } }))
vi.mock('@web/src/auth/AuthContext', () => ({ useAuth: () => ({
  state: { status: 'authenticated' }, invalidateSession: vi.fn(),
  refreshProfile: vi.fn(), retrySession: vi.fn(), logout: vi.fn(),
}) }))
vi.mock('@exre/exui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@exre/exui')>()),
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}))

import { SettingsExperience, SettingsModal } from '@web/src/settings/SettingsExperience'

const profile = {
  id: '8e5b2093-dcce-422c-af4d-e4b58ba66ab5', email: 'person@example.com',
  nickname: 'Person', qq: '123456789', fivemId: null, avatarUrl: null,
}

afterEach(() => {
  cleanup()
  get.mockReset()
  bindSettingsToken(null)
  bindNotificationsToken(null)
  window.localStorage.clear()
})

it.each([false, true])('shows the returned profile in the real settings panel (StrictMode=%s)', async (strict) => {
  writeToken(window.localStorage, 'test-token')
  get.mockResolvedValue(profile)
  const panel = <SettingsExperience initialCategory="profile" />
  render(strict ? <StrictMode>{panel}</StrictMode> : panel)
  expect(get).toHaveBeenCalledWith('/auth/me', { alert: false })
  await waitFor(() => expect(screen.queryByRole('button', { name: '编辑用户名' })?.textContent ?? '')
    .toContain('Person'), { onTimeout: (error) => error })
})

it('shows profile fields when the settings modal opens under StrictMode', async () => {
  writeToken(window.localStorage, 'test-token')
  get.mockResolvedValue(profile)
  render(<StrictMode><SettingsModal initialCategory="profile" onClose={vi.fn()} /></StrictMode>)
  expect(await screen.findByRole('button', { name: '编辑用户名' })).toHaveProperty('textContent', 'Person')
  expect(screen.getByRole('dialog', { name: '设置' })).toBeTruthy()
})

it('keeps the new read when the discarded StrictMode read completes later', async () => {
  writeToken(window.localStorage, 'test-token')
  let resolveOld!: (value: typeof profile) => void
  get.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    .mockResolvedValue(profile)
  render(<StrictMode><SettingsExperience initialCategory="profile" /></StrictMode>)
  expect(await screen.findByRole('button', { name: '编辑用户名' })).toHaveProperty('textContent', 'Person')
  expect(get).toHaveBeenCalledTimes(2)
  await act(async () => { resolveOld({ ...profile, nickname: 'Outdated' }) })
  expect(screen.getByRole('button', { name: '编辑用户名' })).toHaveProperty('textContent', 'Person')
})
