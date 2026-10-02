// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { AUTH_TOKEN_KEY } from '@web/src/auth/storage'

const get = vi.hoisted(() => vi.fn())
vi.mock('@web/src/api/client', () => ({ api: { GET: get } }))

import { SignedOutPage } from '@web/src/pages/IdentityPage/SignedOutPage'

afterEach(() => { cleanup(); get.mockReset(); window.localStorage.clear() })

describe('signed-out landing', () => {
  it('clears the same token only after the server confirms it is invalid', async () => {
    window.localStorage.setItem(AUTH_TOKEN_KEY, 'expired-token')
    get.mockResolvedValue({ error: { error: { code: 'SESSION_INVALID' } } })
    render(<MemoryRouter><SignedOutPage /></MemoryRouter>)
    expect(await screen.findByText(/当前浏览器已退出/)).toBeTruthy()
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull()
  })

  it('removes only the token confirmed invalid by the profile operation', async () => {
    window.localStorage.setItem(AUTH_TOKEN_KEY, 'old-token')
    get.mockImplementation(async () => {
      window.localStorage.setItem(AUTH_TOKEN_KEY, 'new-token')
      return { error: { error: { code: 'SESSION_INVALID' } } }
    })
    render(<MemoryRouter><SignedOutPage /></MemoryRouter>)
    await waitFor(() => expect(get).toHaveBeenCalledWith('/auth/me', {
      headers: { Authorization: 'Bearer old-token' },
    }))
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBe('new-token')
  })

  it('keeps the current token on network failure and offers retry', async () => {
    window.localStorage.setItem(AUTH_TOKEN_KEY, 'current-token')
    get.mockRejectedValue(new Error('network down'))
    render(<MemoryRouter><SignedOutPage /></MemoryRouter>)
    expect(await screen.findByRole('button', { name: '重试' })).toBeTruthy()
    expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBe('current-token')
  })
})
