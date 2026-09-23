import { afterEach, describe, expect, it } from 'vitest'
import { createApp, serviceHandlers } from '@workspace/mock-server'
import { createTestAuth } from '../helpers/auth'

const runningApps: Array<ReturnType<typeof createApp>> = []
const authFixtures: Array<ReturnType<typeof createTestAuth>> = []

afterEach(async () => {
  await Promise.all(runningApps.splice(0).map((app) => app.close()))
  authFixtures.splice(0).forEach((fixture) => fixture.close())
})

describe('POST /api/auth/captcha/challenges', () => {
  it('returns a no-store placeholder PNG with an opaque challenge id', async () => {
    const fixture = createTestAuth()
    authFixtures.push(fixture)
    const app = createApp({ authServices: fixture.authServices, profileServices: fixture.profileServices, logger: false })
    runningApps.push(app)

    const response = await app.inject({ method: 'POST', url: '/api/auth/captcha/challenges' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    const challenge = response.json() as { challengeId: string; imageBase64: string; expiresAt: number }
    expect(Object.keys(challenge)).toEqual(['challengeId', 'imageBase64', 'expiresAt'])
    expect(challenge.challengeId).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(challenge.imageBase64, 'base64').subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(challenge.expiresAt).toBeGreaterThan(Date.now())

    const raw = await serviceHandlers.createCaptchaChallenge({} as Parameters<typeof serviceHandlers.createCaptchaChallenge>[0], createRawReply())
    expect(Object.keys(raw)).toEqual(['challengeId', 'imageBase64', 'expiresAt'])
    expect(raw.challengeId).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})

describe('POST /api/auth/registrations', () => {
  it('creates a verification challenge without exposing the code', async () => {
    const fixture = createTestAuth()
    authFixtures.push(fixture)
    const app = createApp({ authServices: fixture.authServices, profileServices: fixture.profileServices, logger: false })
    runningApps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/registrations',
      payload: {
        email: 'member@example.com',
        nickname: '成员',
        password: 'correct horse battery staple',
      },
    })

    expect(response.statusCode).toBe(201)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toMatchObject({
      email: 'member@example.com',
    })
    expect(response.body).not.toContain('correct horse battery staple')
    expect(response.body).not.toMatch(/"code"\s*:/)
    expect(fixture.deliveries).toEqual([{ email: 'member@example.com', code: '123456' }])
  })

  it('normalizes public fields and completes the account, session, and logout lifecycle', async () => {
    const fixture = createTestAuth()
    authFixtures.push(fixture)
    const app = createApp({ authServices: fixture.authServices, profileServices: fixture.profileServices, logger: false })
    runningApps.push(app)

    const started = await app.inject({
      method: 'POST',
      url: '/api/auth/registrations',
      payload: {
        email: '  Member@Example.COM  ',
        nickname: '  成员  ',
        password: 'correct horse battery staple',
      },
    })
    expect(started.statusCode).toBe(201)
    const challenge = started.json() as { registrationId: string }

    const verified = await app.inject({
      method: 'POST',
      url: '/api/auth/registrations/verify',
      payload: { registrationId: challenge.registrationId, code: '123456' },
    })
    expect(verified.statusCode).toBe(200)
    expect(verified.json()).toEqual({ status: 'registered', email: 'member@example.com' })

    const loggedIn = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'MEMBER@example.com', password: 'correct horse battery staple' },
    })
    expect(loggedIn.statusCode).toBe(200)
    const session = loggedIn.json() as { token: string; expiresAt: number }
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${session.token}` },
    })
    expect(me.statusCode).toBe(200)
    expect(me.json()).toEqual({
      id: '10000000-0000-4000-8000-000000000001',
      email: 'member@example.com',
      nickname: '成员',
      qq: null,
      fivemId: null,
      avatarUrl: null,
    })

    const signedOut = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${session.token}` },
    })
    expect(signedOut.statusCode).toBe(200)
    expect(signedOut.json()).toEqual({ status: 'signed-out' })

    const afterLogout = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${session.token}` },
    })
    expect(afterLogout.statusCode).toBe(401)
    expect(afterLogout.json()).toMatchObject({ error: { code: 'SESSION_INVALID' } })
  })

  it('commits failed code attempts and requires a resend after the fifth failure', async () => {
    const fixture = createTestAuth()
    authFixtures.push(fixture)
    const app = createApp({ authServices: fixture.authServices, profileServices: fixture.profileServices, logger: false })
    runningApps.push(app)

    const started = await app.inject({
      method: 'POST',
      url: '/api/auth/registrations',
      payload: {
        email: 'attempts@example.com',
        nickname: 'Attempts',
        password: 'a secure password',
      },
    })
    const { registrationId } = started.json() as { registrationId: string }

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/registrations/verify',
        payload: { registrationId, code: '000000' },
      })
      expect(response.statusCode).toBe(attempt === 5 ? 409 : 400)
      expect(response.json()).toMatchObject({
        error: { code: attempt === 5 ? 'CODE_ATTEMPTS_EXHAUSTED' : 'CODE_INVALID' },
      })
    }

    const correctButLocked = await app.inject({
      method: 'POST',
      url: '/api/auth/registrations/verify',
      payload: { registrationId, code: '123456' },
    })
    expect(correctButLocked.statusCode).toBe(409)
    expect(correctButLocked.json()).toMatchObject({ error: { code: 'CODE_ATTEMPTS_EXHAUSTED' } })
  })

  it('completes SSO without creating a local session', async () => {
    const fixture = createTestAuth()
    authFixtures.push(fixture)
    const app = createApp({ authServices: fixture.authServices, profileServices: fixture.profileServices, logger: false })
    runningApps.push(app)

    const registration = await fixture.authServices.startRegistration({
      email: 'sso@example.com',
      nickname: 'SSO',
      password: 'sso password',
    })
    fixture.authServices.verifyRegistration(registration.registrationId, '123456')
    const sso = fixture.authServices.createSsoRequest()

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sso/login',
      payload: {
        ssoRequestId: sso.ssoRequestId,
        email: 'sso@example.com',
        password: 'sso password',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'completed', ssoRequestId: sso.ssoRequestId })
    expect(fixture.sqlite.prepare('SELECT count(*) AS count FROM auth_sessions').get()).toEqual({ count: 0 })
    expect(fixture.authServices.inspectSsoRequestForCli(sso.ssoRequestId)).toMatchObject({
      status: 'completed',
      userId: '10000000-0000-4000-8000-000000000001',
    })
  })

  it('routes resend, cancel, SSO inspect, and session confirmation through the contract', async () => {
    const codes = [123456, 654321]
    const fixture = createTestAuth({ randomInteger: () => codes.shift() ?? 111111 })
    authFixtures.push(fixture)
    const app = createApp({ authServices: fixture.authServices, profileServices: fixture.profileServices, logger: false })
    runningApps.push(app)

    const started = await app.inject({
      method: 'POST',
      url: '/api/auth/registrations',
      payload: {
        email: 'remaining@example.com', nickname: 'Remaining', password: 'valid password',
      },
    })
    const { registrationId } = started.json() as { registrationId: string }
    fixture.advance(60_000)
    const resent = await app.inject({
      method: 'POST', url: '/api/auth/registrations/resend', payload: { registrationId },
    })
    expect(resent.statusCode).toBe(200)
    expect(resent.headers['cache-control']).toBe('no-store')
    expect(resent.json()).toMatchObject({ registrationId, email: 'remaining@example.com' })

    const cancelled = await app.inject({
      method: 'POST', url: '/api/auth/registrations/cancel', payload: { registrationId },
    })
    expect(cancelled.statusCode).toBe(200)
    expect(cancelled.headers['cache-control']).toBe('no-store')
    expect(cancelled.json()).toEqual({ status: 'cancelled' })

    const account = await fixture.authServices.startRegistration({
      email: 'confirm@example.com', nickname: 'Confirm', password: 'valid password',
    })
    fixture.authServices.verifyRegistration(account.registrationId, '111111')
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'confirm@example.com', password: 'valid password' },
    })
    const { token } = loginResponse.json() as { token: string }
    const sso = fixture.authServices.createSsoRequest()

    const inspected = await app.inject({
      method: 'POST', url: '/api/auth/sso/inspect', payload: { ssoRequestId: sso.ssoRequestId },
    })
    expect(inspected.statusCode).toBe(200)
    expect(inspected.headers['cache-control']).toBe('no-store')
    expect(inspected.json()).toMatchObject({ ssoRequestId: sso.ssoRequestId, status: 'pending' })

    const confirmed = await app.inject({
      method: 'POST',
      url: '/api/auth/sso/confirm',
      headers: { authorization: `Bearer ${token}` },
      payload: { ssoRequestId: sso.ssoRequestId },
    })
    expect(confirmed.statusCode).toBe(200)
    expect(confirmed.headers['cache-control']).toBe('no-store')
    expect(confirmed.json()).toEqual({ status: 'completed', ssoRequestId: sso.ssoRequestId })
    expect(fixture.sqlite.prepare('SELECT count(*) AS count FROM auth_sessions').get()).toEqual({ count: 1 })
  })

  it('rejects extra fields including the removed QQ field', async () => {
    const fixture = createTestAuth()
    authFixtures.push(fixture)
    const app = createApp({ authServices: fixture.authServices, profileServices: fixture.profileServices, logger: false })
    runningApps.push(app)

    const extra = await app.inject({
      method: 'POST',
      url: '/api/auth/registrations',
      payload: {
        email: 'invalid@example.com',
        nickname: 'Invalid',
        password: 'valid password',
        code: '123456',
      },
    })
    expect(extra.statusCode).toBe(400)

    const removedQq = await app.inject({
      method: 'POST',
      url: '/api/auth/registrations',
      payload: {
        email: 'invalid@example.com',
        nickname: 'Invalid',
        qq: 45678901,
        password: 'valid password',
      },
    })
    expect(removedQq.statusCode).toBe(400)
    expect(fixture.deliveries).toEqual([])
  })

  it('returns contract-shaped values from every registered auth handler before serialization', async () => {
    const codes = [123456, 654321, 111111]
    const fixture = createTestAuth({ randomInteger: () => codes.shift() ?? 222222 })
    authFixtures.push(fixture)
    const reply = createRawReply()

    const started = await serviceHandlers.startRegistration(
      rawRequest(fixture, {
        email: 'raw@example.com',
        nickname: 'Raw',
        password: 'raw password',
      }),
      reply,
    )
    expect(Object.keys(started)).toEqual([
      'registrationId', 'email', 'serverTime', 'codeExpiresAt', 'resendAvailableAt',
    ])

    fixture.advance(60_000)
    const resent = await serviceHandlers.resendRegistrationCode(
      rawRequest(fixture, { registrationId: started.registrationId }),
      reply,
    )
    expect(Object.keys(resent)).toEqual([
      'registrationId', 'email', 'serverTime', 'codeExpiresAt', 'resendAvailableAt',
    ])

    const verified = await serviceHandlers.verifyRegistration(
      rawRequest(fixture, { registrationId: started.registrationId, code: '654321' }),
      reply,
    )
    expect(verified).toEqual({ status: 'registered', email: 'raw@example.com' })

    const loggedIn = await serviceHandlers.login(
      rawRequest(fixture, { email: 'raw@example.com', password: 'raw password' }),
      reply,
    )
    expect(Object.keys(loggedIn)).toEqual(['token', 'expiresAt'])
    const session = fixture.authServices.authenticateToken(loggedIn.token)

    const currentUser = await serviceHandlers.getCurrentUser(rawRequest(fixture, undefined, session), reply)
    expect(Object.keys(currentUser)).toEqual(['id', 'email', 'nickname', 'qq', 'fivemId', 'avatarUrl'])

    const inspectedRequest = fixture.authServices.createSsoRequest()
    const inspected = await serviceHandlers.inspectSsoRequest(
      rawRequest(fixture, { ssoRequestId: inspectedRequest.ssoRequestId }),
      reply,
    )
    expect(Object.keys(inspected)).toEqual(['ssoRequestId', 'status', 'expiresAt', 'serverTime'])

    const confirmedRequest = fixture.authServices.createSsoRequest()
    const confirmed = await serviceHandlers.confirmSsoWithSession(
      rawRequest(fixture, { ssoRequestId: confirmedRequest.ssoRequestId }, session),
      reply,
    )
    expect(confirmed).toEqual({ status: 'completed', ssoRequestId: confirmedRequest.ssoRequestId })

    const passwordRequest = fixture.authServices.createSsoRequest()
    const passwordConfirmed = await serviceHandlers.loginForSso(
      rawRequest(fixture, {
        ssoRequestId: passwordRequest.ssoRequestId,
        email: 'raw@example.com',
        password: 'raw password',
      }),
      reply,
    )
    expect(passwordConfirmed).toEqual({ status: 'completed', ssoRequestId: passwordRequest.ssoRequestId })

    const cancelledStart = await serviceHandlers.startRegistration(
      rawRequest(fixture, {
        email: 'cancel@example.com',
        nickname: 'Cancel',
        password: 'cancel password',
      }),
      reply,
    )
    const cancelled = await serviceHandlers.cancelRegistration(
      rawRequest(fixture, { registrationId: cancelledStart.registrationId }),
      reply,
    )
    expect(cancelled).toEqual({ status: 'cancelled' })

    const signedOut = await serviceHandlers.logout(rawRequest(fixture, undefined, session), reply)
    expect(signedOut).toEqual({ status: 'signed-out' })
  })
})

function rawRequest(
  fixture: ReturnType<typeof createTestAuth>,
  body: unknown,
  authSession?: ReturnType<typeof fixture.authServices.authenticateToken>,
) {
  return {
    body,
    authSession,
    server: { authServices: fixture.authServices, profileServices: fixture.profileServices },
  } as unknown as Parameters<typeof serviceHandlers.startRegistration>[0]
}

function createRawReply() {
  const reply = {
    code: () => reply,
    header: () => reply,
  }
  return reply as unknown as Parameters<typeof serviceHandlers.startRegistration>[1]
}
