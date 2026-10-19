// @vitest-environment jsdom
import { createServer, type Server } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'

let server: Server | undefined
afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  window.localStorage.clear()
  if (server) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = undefined
  }
})

it.each(['/support', '/support/errors/guide?via=direct#step', '/support/unknown'])(
  'retains an expired Support deep link while clearing and notifying the real session: %s',
  async (path) => {
    server = createServer((_request, response) => {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          error: { code: 'SESSION_INVALID', message: 'expired', requestId: 'support-expired' },
        }),
      )
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('expected fixture TCP address')
    vi.stubEnv('VITE_API_BASE_URL', `http://127.0.0.1:${address.port}/api`)
    window.history.replaceState({}, '', path)
    window.localStorage.setItem('exwebsite.auth.token', 'current-token')
    const location = window.location
    const replace = vi.fn()
    // jsdom cannot navigate; expose navigation as an observable browser boundary.
    vi.stubGlobal('window', {
      localStorage: window.localStorage,
      location: {
        origin: location.origin,
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
        replace,
      },
    })
    vi.resetModules()
    const { api } = await import('@web/src/api/client')
    const { subscribeSessionChanges, readToken } = await import('@web/src/auth/storage')
    const observed: Array<string | null> = []
    const unsubscribe = subscribeSessionChanges(() => observed.push(readToken(window.localStorage)))
    try {
      await expect(api.GET('/auth/me', { alert: false })).rejects.toMatchObject({
        code: 'SESSION_INVALID',
      })
      expect(window.localStorage.getItem('exwebsite.auth.token')).toBeNull()
      expect(observed).toEqual([null])
      expect(replace).not.toHaveBeenCalled()
      expect(location.pathname + location.search + location.hash).toBe(path)
    } finally {
      unsubscribe()
    }
  },
)

it('keeps the existing expiry redirect for similarly prefixed non-Support routes', async () => {
  server = createServer((_request, response) => {
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        error: { code: 'SESSION_INVALID', message: 'expired', requestId: 'ordinary-expired' },
      }),
    )
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('expected fixture TCP address')
  vi.stubEnv('VITE_API_BASE_URL', `http://127.0.0.1:${address.port}/api`)
  window.history.replaceState({}, '', '/support-other')
  window.localStorage.setItem('exwebsite.auth.token', 'current-token')
  const replace = vi.fn()
  vi.stubGlobal('window', {
    localStorage: window.localStorage,
    location: {
      origin: window.location.origin,
      pathname: '/support-other',
      search: '',
      replace,
    },
  })
  vi.resetModules()
  const { api } = await import('@web/src/api/client')
  await expect(api.GET('/auth/me', { alert: false })).rejects.toMatchObject({
    code: 'SESSION_INVALID',
  })
  expect(replace).toHaveBeenCalledWith('/login')
})

it('keeps a newer cross-tab session when an old Web API request expires before its storage event', async () => {
  let arrived!: () => void, release!: () => void
  const reached = new Promise<void>((resolve) => {
    arrived = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const authorization: string[] = []
  server = createServer(async (request, response) => {
    authorization.push(request.headers.authorization ?? '')
    response.setHeader('content-type', 'application/json')
    if (authorization.length === 1) {
      arrived()
      await gate
      response.statusCode = 401
      response.end(
        JSON.stringify({
          error: { code: 'SESSION_INVALID', message: 'expired', requestId: 'old-request' },
        }),
      )
    } else response.end(JSON.stringify({ status: 'ok' }))
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('expected fixture TCP address')
  vi.stubEnv('VITE_API_BASE_URL', `http://127.0.0.1:${address.port}/api`)
  window.history.replaceState({}, '', '/login')
  window.localStorage.setItem('exwebsite.auth.token', 'old-token')
  vi.resetModules()
  const { api } = await import('@web/src/api/client')
  const pending = api.GET('/health', { alert: false })
  await reached
  window.localStorage.setItem('exwebsite.auth.token', 'new-token')
  release()
  await expect(pending).rejects.toMatchObject({ code: 'SESSION_INVALID' })
  expect(window.localStorage.getItem('exwebsite.auth.token')).toBe('new-token')
  await expect(api.GET('/health', { alert: false })).resolves.toEqual({ status: 'ok' })
  expect(authorization).toEqual(['Bearer old-token', 'Bearer new-token'])
})

it('clears a matching persisted session and notifies the bound Web session', async () => {
  const authorization: string[] = []
  server = createServer((request, response) => {
    authorization.push(request.headers.authorization ?? '')
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        error: { code: 'SESSION_INVALID', message: 'expired', requestId: 'current-request' },
      }),
    )
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('expected fixture TCP address')
  vi.stubEnv('VITE_API_BASE_URL', `http://127.0.0.1:${address.port}/api`)
  window.history.replaceState({}, '', '/login?ssoRequestId=keep-this-container')
  window.localStorage.setItem('exwebsite.auth.token', 'current-token')
  vi.resetModules()
  const { api } = await import('@web/src/api/client')
  const { subscribeSessionChanges, readToken } = await import('@web/src/auth/storage')
  const observed: Array<string | null> = []
  const unsubscribe = subscribeSessionChanges(() => observed.push(readToken(window.localStorage)))
  try {
    await expect(api.GET('/health', { alert: false })).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    })
    expect(authorization).toEqual(['Bearer current-token'])
    expect(window.localStorage.getItem('exwebsite.auth.token')).toBeNull()
    expect(observed).toEqual([null])
    expect(window.location.pathname).toBe('/login')
    expect(window.location.search).toBe('?ssoRequestId=keep-this-container')
  } finally {
    unsubscribe()
  }
})
