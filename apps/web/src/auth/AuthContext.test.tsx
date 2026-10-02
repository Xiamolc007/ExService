// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTH_TOKEN_KEY } from '@web/src/auth/storage'

const get = vi.hoisted(() => vi.fn())
vi.mock('@web/src/api/client', () => ({ api: { GET: get } }))

import { AuthProvider, useAuth } from '@web/src/auth/AuthContext'

function CurrentState() {
  const auth = useAuth()
  return <p>{auth.state.status}</p>
}

afterEach(() => { cleanup(); get.mockReset(); window.localStorage.clear() })

describe('auth session restore', () => {
  it('does not let an invalid response for an old token clear a replacement token', async () => {
    window.localStorage.setItem(AUTH_TOKEN_KEY, 'old-token')
    let finish: ((value: unknown) => void) | undefined
    get.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    render(<AuthProvider><CurrentState /></AuthProvider>)
    await waitFor(() => expect(finish).toBeDefined())
    window.localStorage.setItem(AUTH_TOKEN_KEY, 'new-token')
    finish?.({ error: { error: { code: 'SESSION_INVALID' } } })
    await waitFor(() => expect(window.localStorage.getItem(AUTH_TOKEN_KEY)).toBe('new-token'))
    expect(screen.getByText('loading')).toBeTruthy()
  })
})
