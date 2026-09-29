import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthService } from '@server/src/auth/service'
import { openDatabase, type AppDatabase } from '@server/src/db/client'
import { createTestAuth, testPasswordHasher, type TestAuth } from '@tests/helpers/auth'

const fixtures: TestAuth[] = []

afterEach(async () => { await Promise.all(fixtures.splice(0).map((fixture) => fixture.close())) })

describe('AuthService session and SSO boundaries', () => {
  it('expires a session exactly seven days after it is issued', async () => {
    const fixture = await createTestAuth()
    fixtures.push(fixture)
    await fixture.seedUser({
      email: 'expiry@example.com', nickname: 'Expiry', password: 'valid password',
    })
    const session = await fixture.authServices.login({ email: 'expiry@example.com', password: 'valid password' })

    fixture.advance(7 * 24 * 60 * 60 * 1000)

    await expect(fixture.authServices.authenticateToken(session.token))
      .rejects.toMatchObject({ code: 'SESSION_INVALID' })
  })

  it('does not let a second account overwrite a completed SSO request', async () => {
    let userCounter = 0
    const fixture = await createTestAuth({
      createUserId: () => `10000000-0000-4000-8000-${String(++userCounter).padStart(12, '0')}`,
    })
    fixtures.push(fixture)
    await register(fixture, 'one@example.com')
    await register(fixture, 'two@example.com')
    const sso = await fixture.authServices.createSsoRequest()

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
    expect((await fixture.db.query<{ count: string }>('SELECT count(*) AS count FROM auth_sessions')).rows[0]).toEqual({ count: '0' })
  })

  it('rejects missing and expired SSO requests', async () => {
    const fixture = await createTestAuth()
    fixtures.push(fixture)
    await register(fixture, 'sso-expiry@example.com')
    const sso = await fixture.authServices.createSsoRequest()

    await expect(fixture.authServices.inspectSsoRequest('a'.repeat(43)))
      .rejects.toMatchObject({ code: 'SSO_REQUEST_NOT_FOUND' })
    fixture.advance(10 * 60 * 1000)
    await expect(fixture.authServices.inspectSsoRequest(sso.ssoRequestId))
      .rejects.toMatchObject({ code: 'SSO_REQUEST_EXPIRED' })
    await expect(fixture.authServices.loginForSso({
      ssoRequestId: sso.ssoRequestId,
      email: 'sso-expiry@example.com',
      password: 'valid password',
    })).rejects.toMatchObject({ code: 'SSO_REQUEST_EXPIRED' })
  })

  it('rechecks a session before completing SSO', async () => {
    const fixture = await createTestAuth()
    fixtures.push(fixture)
    await register(fixture, 'revoked@example.com')
    const login = await fixture.authServices.login({ email: 'revoked@example.com', password: 'valid password' })
    const session = await fixture.authServices.authenticateToken(login.token)
    await fixture.authServices.logout(session)
    const sso = await fixture.authServices.createSsoRequest()

    await expect(fixture.authServices.confirmSsoWithSession(sso.ssoRequestId, session))
      .rejects.toMatchObject({ code: 'SESSION_INVALID' })
    expect(await fixture.authServices.inspectSsoRequestForCli(sso.ssoRequestId)).toMatchObject({ status: 'pending' })
  })

  it('does not complete SSO when logout on another pool commits before the session lock', async () => {
    const fixture = await createTestAuth()
    fixtures.push(fixture)
    await register(fixture, 'race@example.com')
    const login = await fixture.authServices.login({ email: 'race@example.com', password: 'valid password' })
    const session = await fixture.authServices.authenticateToken(login.token)
    const sso = await fixture.authServices.createSsoRequest()
    const secondDb = await openDatabase({ connectionString: fixture.connectionString, searchPath: fixture.schema })
    try {
      let locked!: () => void, release!: () => void
      const hasLock = new Promise<void>(resolve => { locked = resolve })
      const unlock = new Promise<void>(resolve => { release = resolve })
      const revoking = secondDb.transaction(async tx => {
        await tx.query('SELECT token_hash FROM auth_sessions WHERE token_hash = $1 FOR UPDATE', [session.tokenHash])
        locked()
        await unlock
        await tx.query('UPDATE auth_sessions SET revoked_at = $1 WHERE token_hash = $2', [fixture.now(), session.tokenHash])
      })
      await hasLock
      const confirming = fixture.authServices.confirmSsoWithSession(sso.ssoRequestId, session)
      await waitForBlockedQuery(secondDb, 'auth_sessions')
      release()
      await revoking
      await expect(confirming).rejects.toMatchObject({ code: 'SESSION_INVALID' })
      expect(await fixture.authServices.inspectSsoRequestForCli(sso.ssoRequestId)).toMatchObject({ status: 'pending' })
    } finally { await secondDb.close() }
  })

  it('completes SSO before a competing logout can revoke the locked session', async () => {
    const fixture = await createTestAuth()
    fixtures.push(fixture)
    await register(fixture, 'race@example.com')
    const login = await fixture.authServices.login({ email: 'race@example.com', password: 'valid password' })
    const session = await fixture.authServices.authenticateToken(login.token)
    const sso = await fixture.authServices.createSsoRequest()
    const secondDb = await openDatabase({ connectionString: fixture.connectionString, searchPath: fixture.schema })
    try {
      let locked!: () => void, release!: () => void
      const hasLock = new Promise<void>(resolve => { locked = resolve })
      const unlock = new Promise<void>(resolve => { release = resolve })
      const holdingSso = secondDb.transaction(async tx => {
        await tx.query("SELECT id_hash FROM auth_sso_requests WHERE status = 'pending' FOR UPDATE")
        locked()
        await unlock
      })
      await hasLock
      const confirming = fixture.authServices.confirmSsoWithSession(sso.ssoRequestId, session)
      await waitForBlockedQuery(secondDb, 'auth_sso_requests')
      const otherAuth = new AuthService({ db: secondDb, now: fixture.now, passwordHasher: testPasswordHasher })
      const loggingOut = otherAuth.logout(session)
      release()
      await holdingSso
      expect(await confirming).toEqual({ status: 'completed', ssoRequestId: sso.ssoRequestId })
      expect(await loggingOut).toEqual({ status: 'signed-out' })
      expect(await fixture.authServices.inspectSsoRequestForCli(sso.ssoRequestId)).toMatchObject({ status: 'completed' })
    } finally { await secondDb.close() }
  })
})

async function waitForBlockedQuery(db: AppDatabase, table: string) {
  await vi.waitFor(async () => {
    const { rows } = await db.query<{ n: number }>(`SELECT count(*) n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE $1`, [`%${table}%`])
    expect(rows[0]?.n).toBeGreaterThan(0)
  }, { timeout: 3000, interval: 20 })
}


async function register(fixture: TestAuth, email: string) {
  await fixture.seedUser({
    email, nickname: email.split('@')[0] ?? 'User', password: 'valid password',
  })
}
