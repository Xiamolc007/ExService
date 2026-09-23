import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { assertCommunitySchemaAvailable } from '../../apps/mock-server/src/community/schema-check'
import { createTestAuth } from '../helpers/auth'

function migration(name: string) {
  return readFileSync(fileURLToPath(new URL(`../../apps/mock-server/drizzle/${name}`, import.meta.url)), 'utf8')
    .replaceAll('--> statement-breakpoint', '')
}

const fixtures: Array<ReturnType<typeof createTestAuth>> = []
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.close()))

describe('general community membership', () => {
  it('backfills existing users while preserving auth state', () => {
    const sqlite = new Database(':memory:')
    try {
      sqlite.pragma('foreign_keys = ON')
      for (const name of ['0001_auth.sql', '0002_remove-registration-qq.sql', '0003_gifted_network.sql']) {
        sqlite.exec(migration(name))
      }
      expect(() => assertCommunitySchemaAvailable(sqlite)).toThrow('pnpm db:migrate')
      sqlite.exec(`
        INSERT INTO auth_users (id, email, nickname, password_hash, created_at) VALUES
          ('user-1', 'first@example.com', 'First', 'hash', 100),
          ('user-2', 'second@example.com', 'Second', 'hash', 101);
        INSERT INTO auth_sessions VALUES ('token-hash', 'user-1', 100, 1000, NULL);
        INSERT INTO auth_sso_requests VALUES ('sso-hash', 100, 1000, 'completed', 'user-2', 101);
        INSERT INTO auth_registrations (id_hash, email, nickname, password_hash, code_digest, status,
          failed_attempts, last_sent_at, code_expires_at, retain_until)
        VALUES ('pending-hash', 'new@example.com', 'Pending', 'pending-password', 'code-hash',
          'pending', 0, 100, 1000, 2000);
      `)
      sqlite.transaction(() => sqlite.exec(migration('0004_lame_saracen.sql')))()
      expect(() => assertCommunitySchemaAvailable(sqlite)).not.toThrow()
      expect(sqlite.prepare('SELECT * FROM community_groups').all()).toEqual([
        { code: 'general', display_name: '通用' },
      ])
      expect(sqlite.prepare('SELECT user_id, group_code FROM community_group_memberships ORDER BY user_id').all())
        .toEqual([
          { user_id: 'user-1', group_code: 'general' },
          { user_id: 'user-2', group_code: 'general' },
        ])
      expect(sqlite.prepare('SELECT user_id FROM auth_sessions').get()).toEqual({ user_id: 'user-1' })
      expect(sqlite.prepare('SELECT user_id FROM auth_sso_requests').get()).toEqual({ user_id: 'user-2' })
      expect(sqlite.prepare('SELECT status FROM auth_registrations').get()).toEqual({ status: 'pending' })
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
      expect(() => sqlite.prepare('DELETE FROM community_groups WHERE code = ?').run('general')).toThrow()
    } finally {
      sqlite.close()
    }
  })

  it('creates the reserved group on a fresh database and rejects a missing seed', () => {
    const fixture = createTestAuth()
    fixtures.push(fixture)
    expect(fixture.sqlite.prepare('SELECT * FROM community_groups').all()).toEqual([
      { code: 'general', display_name: '通用' },
    ])
    fixture.sqlite.prepare('DELETE FROM community_groups WHERE code = ?').run('general')
    expect(() => assertCommunitySchemaAvailable(fixture.sqlite)).toThrow('pnpm db:migrate')
  })

  it('adds a new user once only after verification succeeds', async () => {
    const fixture = createTestAuth()
    fixtures.push(fixture)
    const challenge = await fixture.authServices.startRegistration({
      email: 'new@example.com', nickname: 'New', password: 'valid password',
    })
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM community_group_memberships').get())
      .toEqual({ count: 0 })
    expect(() => fixture.authServices.verifyRegistration(challenge.registrationId, '000000')).toThrow()
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM auth_users').get()).toEqual({ count: 0 })
    expect(fixture.authServices.verifyRegistration(challenge.registrationId, '123456')).toEqual({
      status: 'registered', email: 'new@example.com',
    })
    expect(fixture.authServices.verifyRegistration(challenge.registrationId, '123456')).toEqual({
      status: 'registered', email: 'new@example.com',
    })
    expect(fixture.sqlite.prepare('SELECT group_code FROM community_group_memberships').all())
      .toEqual([{ group_code: 'general' }])
  })

  it('rolls back the account and registration status when membership insertion fails', async () => {
    const fixture = createTestAuth()
    fixtures.push(fixture)
    const challenge = await fixture.authServices.startRegistration({
      email: 'new@example.com', nickname: 'New', password: 'valid password',
    })
    fixture.sqlite.exec(`CREATE TRIGGER fail_membership BEFORE INSERT ON community_group_memberships
      BEGIN SELECT RAISE(ABORT, 'membership failure'); END`)
    expect(() => fixture.authServices.verifyRegistration(challenge.registrationId, '123456'))
      .toThrow('membership failure')
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM auth_users').get()).toEqual({ count: 0 })
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM community_group_memberships').get())
      .toEqual({ count: 0 })
    expect(fixture.sqlite.prepare('SELECT status FROM auth_registrations').get()).toEqual({ status: 'pending' })
    fixture.sqlite.exec('DROP TRIGGER fail_membership')
    expect(fixture.authServices.verifyRegistration(challenge.registrationId, '123456')).toEqual({
      status: 'registered', email: 'new@example.com',
    })
  })
})
