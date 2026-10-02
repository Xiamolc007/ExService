import { afterEach, expect, it } from 'vitest'
import { createTestAuth, type TestAuth } from '@tests/helpers/auth'

const fixtures: TestAuth[] = []
afterEach(async () => { await Promise.all(fixtures.splice(0).map(fixture => fixture.close())) })

it('checks only the bound client and revokes one browser session group', async () => {
  const fixture = await createTestAuth()
  fixtures.push(fixture)
  const userId = await fixture.seedUser({ email: 'bound@example.com', nickname: 'Bound', password: 'valid password' })
  const first = await fixture.authServices.login({ email: 'bound@example.com', password: 'valid password' })
  const second = await fixture.authServices.login({ email: 'bound@example.com', password: 'valid password' })
  const firstSession = await fixture.authServices.authenticateToken(first.token)
  await fixture.db.query(`INSERT INTO auth_oidc_bindings (client_id, hydra_sid, session_id, user_id, created_at)
    VALUES ('outline', 'sid-a', $1, $2, $3)`, [firstSession.id, userId, fixture.now()])
  const check = await fixture.authServices.checkLinkedSession('outline', 'sid-a', userId)
  expect(check).toMatchObject({ active: true, sessionId: firstSession.id, userId,
    profile: { nickname: 'Bound', email: 'bound@example.com', version: 0 } })
  expect(await fixture.authServices.checkLinkedSession('other-client', 'sid-a', userId))
    .toEqual({ active: false, reason: 'unknown' })
  expect(await fixture.authServices.revokeLinkedSession('outline', 'sid-a', userId)).toEqual({ revoked: true })
  expect(await fixture.authServices.checkLinkedSession('outline', 'sid-a', userId))
    .toEqual({ active: false, reason: 'revoked' })
  await expect(fixture.authServices.authenticateToken(first.token)).rejects.toMatchObject({ code: 'SESSION_INVALID' })
  await expect(fixture.authServices.authenticateToken(second.token)).resolves.toMatchObject({ userId })
  const queued = await fixture.db.query<{ target_bindings: string }>(
    'SELECT target_bindings FROM auth_identity_outbox WHERE session_id = $1', [firstSession.id])
  expect(queued.rows).toHaveLength(1)
  expect(JSON.parse(queued.rows[0]!.target_bindings)).toEqual([{ clientId: 'outline', hydraSid: 'sid-a' }])
})
