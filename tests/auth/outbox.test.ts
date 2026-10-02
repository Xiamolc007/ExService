import { afterEach, expect, it, vi } from 'vitest'
import { IdentityOutboxWorker } from '@server/src/identity/outbox'
import { createTestAuth, type TestAuth } from '@tests/helpers/auth'

const fixtures: TestAuth[] = []
afterEach(async () => { await Promise.all(fixtures.splice(0).map(fixture => fixture.close())) })

it('delivers a revoked session by sid and retries each durable target after a failure', async () => {
  const fixture = await createTestAuth()
  fixtures.push(fixture)
  const userId = await fixture.seedUser({ email: 'outbox@example.com', nickname: 'Outbox', password: 'valid password' })
  const login = await fixture.authServices.login({ email: 'outbox@example.com', password: 'valid password' })
  const session = await fixture.authServices.authenticateToken(login.token)
  await fixture.db.query(`INSERT INTO auth_oidc_bindings
    (client_id, hydra_sid, session_id, user_id, created_at) VALUES ('ex-outline', 'sid-one', $1, $2, $3)`,
  [session.id, userId, fixture.now()])
  await fixture.authServices.logout(session)
  const hydra = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  const outline = vi.fn().mockResolvedValue(undefined)
  const worker = new IdentityOutboxWorker(fixture.db, hydra, outline, fixture.now)
  expect(await worker.drainOne()).toBe(true)
  expect(hydra).toHaveBeenCalledWith('sid-one')
  expect(outline).not.toHaveBeenCalled()
  fixture.advance(1000)
  expect(await worker.drainOne()).toBe(true)
  expect(hydra).toHaveBeenCalledTimes(2)
  expect(outline).toHaveBeenCalledWith(expect.objectContaining({ sessionId: session.id }))
  expect(await worker.drainOne()).toBe(false)
  const row = (await fixture.db.query<{ completed_at: number | null }>(
    'SELECT completed_at FROM auth_identity_outbox WHERE session_id = $1', [session.id])).rows[0]
  expect(row?.completed_at).toBe(fixture.now())
})
