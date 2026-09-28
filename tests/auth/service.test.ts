import { afterEach, describe, expect, it } from 'vitest'
import { createTestAuth } from '@tests/helpers/auth'

const fixtures: Array<ReturnType<typeof createTestAuth>> = []

afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.close()))

describe('AuthService session and SSO boundaries', () => {
  it('expires a session exactly seven days after it is issued', async () => {
    const fixture = createTestAuth()
    fixtures.push(fixture)
    await fixture.seedUser({
      email: 'expiry@example.com', nickname: 'Expiry', password: 'valid password',
    })
    const session = await fixture.authServices.login({ email: 'expiry@example.com', password: 'valid password' })

    fixture.advance(7 * 24 * 60 * 60 * 1000)

    expect(() => fixture.authServices.authenticateToken(session.token))
      .toThrow(expect.objectContaining({ code: 'SESSION_INVALID' }))
  })

  it('does not let a second account overwrite a completed SSO request', async () => {
    let userCounter = 0
    const fixture = createTestAuth({
      createUserId: () => `10000000-0000-4000-8000-${String(++userCounter).padStart(12, '0')}`,
    })
    fixtures.push(fixture)
    await register(fixture, 'one@example.com')
    await register(fixture, 'two@example.com')
    const sso = fixture.authServices.createSsoRequest()

    await fixture.authServices.loginForSso({
      ssoRequestId: sso.ssoRequestId,
      email: 'one@example.com',
      password: 'valid password',
    })
    await expect(fixture.authServices.loginForSso({
      ssoRequestId: sso.ssoRequestId,
      email: 'one@example.com',
      password: 'valid password',
    })).resolves.toEqual({ status: 'completed', ssoRequestId: sso.ssoRequestId })

    await expect(fixture.authServices.loginForSso({
      ssoRequestId: sso.ssoRequestId,
      email: 'two@example.com',
      password: 'valid password',
    })).rejects.toMatchObject({ code: 'SSO_ACCOUNT_CONFLICT' })
    expect(fixture.sqlite.prepare('SELECT count(*) AS count FROM auth_sessions').get()).toEqual({ count: 0 })
  })

  it('rejects missing and expired SSO requests', async () => {
    const fixture = createTestAuth()
    fixtures.push(fixture)
    await register(fixture, 'sso-expiry@example.com')
    const sso = fixture.authServices.createSsoRequest()

    expect(() => fixture.authServices.inspectSsoRequest('a'.repeat(43)))
      .toThrow(expect.objectContaining({ code: 'SSO_REQUEST_NOT_FOUND' }))
    fixture.advance(10 * 60 * 1000)
    expect(() => fixture.authServices.inspectSsoRequest(sso.ssoRequestId))
      .toThrow(expect.objectContaining({ code: 'SSO_REQUEST_EXPIRED' }))
    await expect(fixture.authServices.loginForSso({
      ssoRequestId: sso.ssoRequestId,
      email: 'sso-expiry@example.com',
      password: 'valid password',
    })).rejects.toMatchObject({ code: 'SSO_REQUEST_EXPIRED' })
  })

  it('rechecks a session before completing SSO', async () => {
    const fixture = createTestAuth()
    fixtures.push(fixture)
    await register(fixture, 'revoked@example.com')
    const login = await fixture.authServices.login({ email: 'revoked@example.com', password: 'valid password' })
    const session = fixture.authServices.authenticateToken(login.token)
    fixture.authServices.logout(session)
    const sso = fixture.authServices.createSsoRequest()

    expect(() => fixture.authServices.confirmSsoWithSession(sso.ssoRequestId, session))
      .toThrow(expect.objectContaining({ code: 'SESSION_INVALID' }))
    expect(fixture.authServices.inspectSsoRequestForCli(sso.ssoRequestId)).toMatchObject({ status: 'pending' })
  })
})

async function register(fixture: ReturnType<typeof createTestAuth>, email: string) {
  await fixture.seedUser({
    email, nickname: email.split('@')[0] ?? 'User', password: 'valid password',
  })
}
