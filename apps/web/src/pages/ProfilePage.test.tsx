// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { writeToken } from '../auth/storage'

const get = vi.hoisted(() => vi.fn())
const invalidateSession = vi.hoisted(() => vi.fn())
vi.mock('../api/client', () => ({ api: { GET: get } }))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({
  state: { status: 'authenticated' }, openModal: vi.fn(), invalidateSession,
}) }))
vi.mock('@workspace/components', () => ({ ProfileEditor: () => <div>资料表单</div> }))

import { ProfilePage } from './ProfilePage'

afterEach(() => {
  cleanup()
  get.mockReset()
  invalidateSession.mockReset()
  window.localStorage.clear()
})

describe('ProfilePage loading errors', () => {
  it('ends loading after a temporary failure and retries successfully', async () => {
    writeToken(window.localStorage, 'old-token')
    get.mockResolvedValueOnce({ error: { error: { code: 'INTERNAL_ERROR', message: '暂时无法读取' } } })
      .mockResolvedValueOnce({ data: {
        id: 'user', email: 'person@example.com', nickname: 'Person',
        qq: null, fivemId: null, avatarUrl: null,
      } })
    render(<ProfilePage />)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '暂时无法读取')
    expect(screen.queryByLabelText('正在读取个人资料')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '重试读取资料' }))
    expect(await screen.findByText('资料表单')).toBeTruthy()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('reports an invalid session to the shared auth state', async () => {
    writeToken(window.localStorage, 'expired-token')
    get.mockResolvedValue({ error: { error: { code: 'SESSION_INVALID', message: '会话已失效' } } })
    render(<ProfilePage />)
    await waitFor(() => expect(invalidateSession).toHaveBeenCalledWith('expired-token'))
  })
})
