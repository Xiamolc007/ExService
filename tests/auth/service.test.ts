import { afterEach, describe, expect, it } from 'vitest'
import { createTestAuth } from '../helpers/auth'

const fixtures: Array<ReturnType<typeof createTestAuth>> = []

afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.close()))

describe('AuthService registration boundaries', () => {
  it('allows accounts to share the same display username without a QQ number', async () => {
    let counter = 0
    const fixture = createTestAuth({ createUserId: () => `10000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` })
    fixtures.push(fixture)
    for (const email of ['first@example.com', 'second@example.com']) {
      const challenge = await fixture.authServices.startRegistration({ email, nickname: '同名用户', password: 'valid password' })
      expect(fixture.authServices.verifyRegistration(challenge.registrationId, '123456')).toEqual({ status: 'registered', email })
    }
    expect(fixture.sqlite.prepare('SELECT nickname FROM auth_users').all()).toEqual([{ nickname: '同名用户' }, { nickname: '同名用户' }])
  })
  it('enforces the resend boundary and invalidates the previous code', async () => {
    const codes = [111111, 222222]
    const fixture = createTestAuth({ randomInteger: () => codes.shift() ?? 333333 })
    fixtures.push(fixture)
    const registration = await fixture.authServices.startRegistration({
      email: 'resend@example.com', nickname: 'Resend', password: 'valid password',
    })

    fixture.advance(59_000)
    await expect(fixture.authServices.resendRegistrationCode(registration.registrationId))
      .rejects.toMatchObject({ code: 'CODE_RESEND_TOO_SOON', retryAfterSeconds: 1 })

    fixture.advance(1_000)
    await fixture.authServices.resendRegistrationCode(registration.registrationId)
    expect(() => fixture.authServices.verifyRegistration(registration.registrationId, '111111'))
      .toThrow(expect.objectContaining({ code: 'CODE_INVALID' }))
    expect(fixture.authServices.verifyRegistration(registration.registrationId, '222222'))
      .toEqual({ status: 'registered', email: 'resend@example.com' })
  })

  it('lets only one pending registration win the final email uniqueness race', async () => {
    let userCounter = 0
    const fixture = createTestAuth({
      createUserId: () => `10000000-0000-4000-8000-${String(++userCounter).padStart(12, '0')}`,
    })
    fixtures.push(fixture)
    const first = await fixture.authServices.startRegistration({
      email: 'race@example.com', nickname: 'First', password: 'valid password',
    })
    fixture.advance(60_000)
    const second = await fixture.authServices.startRegistration({
      email: 'race@example.com', nickname: 'Second', password: 'valid password',
    })

    expect(fixture.authServices.verifyRegistration(first.registrationId, '123456'))
      .toEqual({ status: 'registered', email: 'race@example.com' })
    expect(() => fixture.authServices.verifyRegistration(second.registrationId, '123456'))
      .toThrow(expect.objectContaining({ code: 'REGISTRATION_CANCELLED' }))
    expect(fixture.sqlite.prepare('SELECT count(*) AS count FROM auth_users').get()).toEqual({ count: 1 })
  })

  it('supports an idempotent completed verification without revealing completion to wrong codes', async () => {
    const fixture = createTestAuth()
    fixtures.push(fixture)
    const registration = await fixture.authServices.startRegistration({
      email: 'idempotent@example.com', nickname: 'Idempotent', password: 'valid password',
    })

    expect(fixture.authServices.verifyRegistration(registration.registrationId, '123456'))
      .toEqual({ status: 'registered', email: 'idempotent@example.com' })
    expect(fixture.authServices.verifyRegistration(registration.registrationId, '123456'))
      .toEqual({ status: 'registered', email: 'idempotent@example.com' })
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect(() => fixture.authServices.verifyRegistration(registration.registrationId, '000000'))
        .toThrow(expect.objectContaining({ code: 'CODE_INVALID' }))
    }
    expect(() => fixture.authServices.verifyRegistration(registration.registrationId, '000000'))
      .toThrow(expect.objectContaining({ code: 'REGISTRATION_COMPLETED' }))
    expect(() => fixture.authServices.verifyRegistration(registration.registrationId, '123456'))
      .toThrow(expect.objectContaining({ code: 'REGISTRATION_COMPLETED' }))
    expect(fixture.sqlite.prepare('SELECT count(*) AS count FROM auth_users').get()).toEqual({ count: 1 })
  })

  it('handles leading-zero codes, code expiry, and the registration retention boundary', async () => {
    const codes = [42, 43]
    const fixture = createTestAuth({ randomInteger: () => codes.shift() ?? 44 })
    fixtures.push(fixture)
    const registration = await fixture.authServices.startRegistration({
      email: 'boundaries@example.com', nickname: 'Boundaries', password: 'valid password',
    })
    expect(fixture.deliveries[0]?.code).toBe('000042')

    fixture.advance(10 * 60 * 1000)
    expect(() => fixture.authServices.verifyRegistration(registration.registrationId, '000042'))
      .toThrow(expect.objectContaining({ code: 'CODE_EXPIRED' }))
    await fixture.authServices.resendRegistrationCode(registration.registrationId)
    expect(fixture.authServices.verifyRegistration(registration.registrationId, '000043'))
      .toEqual({ status: 'registered', email: 'boundaries@example.com' })

    const expiring = await fixture.authServices.startRegistration({
      email: 'retention@example.com', nickname: 'Retention', password: 'valid password',
    })
    fixture.advance(24 * 60 * 60 * 1000)
    await expect(fixture.authServices.resendRegistrationCode(expiring.registrationId))
      .rejects.toMatchObject({ code: 'REGISTRATION_EXPIRED' })
    expect(fixture.sqlite.prepare(`
      SELECT status, nickname, password_hash, code_digest
      FROM auth_registrations WHERE email = ?
    `).get('retention@example.com')).toEqual({
      status: 'expired', nickname: null, password_hash: null, code_digest: null,
    })
  })

  it('keeps the email cooldown after cancellation and permits a fresh attempt at 60 seconds', async () => {
    const fixture = createTestAuth()
    fixtures.push(fixture)
    const registration = await fixture.authServices.startRegistration({
      email: 'cancel@example.com', nickname: 'Cancel', password: 'valid password',
    })
    expect(fixture.authServices.cancelRegistration(registration.registrationId)).toEqual({ status: 'cancelled' })
    expect(() => fixture.authServices.verifyRegistration(registration.registrationId, '123456'))
      .toThrow(expect.objectContaining({ code: 'REGISTRATION_CANCELLED' }))
    await expect(fixture.authServices.startRegistration({
      email: 'cancel@example.com', nickname: 'Again', password: 'valid password',
    })).rejects.toMatchObject({ code: 'CODE_RESEND_TOO_SOON' })

    fixture.advance(60_000)
    await expect(fixture.authServices.startRegistration({
      email: 'cancel@example.com', nickname: 'Again', password: 'valid password',
    })).resolves.toMatchObject({ email: 'cancel@example.com' })
  })
})

describe('AuthService session and SSO boundaries', () => {
  it('expires a session exactly seven days after it is issued', async () => {
    const fixture = createTestAuth()
    fixtures.push(fixture)
    const registration = await fixture.authServices.startRegistration({
      email: 'expiry@example.com', nickname: 'Expiry', password: 'valid password',
    })
    fixture.authServices.verifyRegistration(registration.registrationId, '123456')
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
  const registration = await fixture.authServices.startRegistration({
    email, nickname: email.split('@')[0] ?? 'User', password: 'valid password',
  })
  fixture.authServices.verifyRegistration(registration.registrationId, '123456')
}
