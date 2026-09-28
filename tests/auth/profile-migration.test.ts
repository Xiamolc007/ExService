import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { assertProfileSchemaAvailable } from '@server/src/profile/schema-check'

function migration(name: string) {
  return readFileSync(fileURLToPath(new URL(`../../apps/mock-server/drizzle/${name}`, import.meta.url)), 'utf8')
    .replaceAll('--> statement-breakpoint', '')
}

it('adds nullable profile fields without changing existing accounts or sessions', () => {
  const sqlite = new Database(':memory:')
  try {
    sqlite.pragma('foreign_keys = ON')
    sqlite.exec(migration('0001_auth.sql'))
    sqlite.exec(migration('0002_remove-registration-qq.sql'))
    expect(() => assertProfileSchemaAvailable(sqlite)).toThrow('pnpm db:migrate')
    sqlite.exec(`
      INSERT INTO auth_users (id, email, nickname, password_hash, created_at)
      VALUES ('user-1', 'old@example.com', 'Existing', 'hash', 100);
      INSERT INTO auth_sessions VALUES ('token-hash', 'user-1', 100, 1000, NULL);
      INSERT INTO auth_sso_requests VALUES ('sso-hash', 100, 1000, 'completed', 'user-1', 101);
      INSERT INTO auth_registrations (id_hash, email, nickname, password_hash, code_digest, status,
        failed_attempts, last_sent_at, code_expires_at, retain_until)
      VALUES ('pending-hash', 'new@example.com', 'Pending', 'pending-password', 'code-hash',
        'pending', 0, 100, 1000, 2000);
    `)
    sqlite.transaction(() => sqlite.exec(migration('0003_gifted_network.sql')))()
    expect(() => assertProfileSchemaAvailable(sqlite)).not.toThrow()

    expect(sqlite.prepare('SELECT id, email, nickname, qq, fivem_id, avatar_key FROM auth_users').get()).toEqual({
      id: 'user-1', email: 'old@example.com', nickname: 'Existing',
      qq: null, fivem_id: null, avatar_key: null,
    })
    expect(sqlite.prepare('SELECT user_id FROM auth_sessions').get()).toEqual({ user_id: 'user-1' })
    expect(sqlite.prepare('SELECT user_id FROM auth_sso_requests').get()).toEqual({ user_id: 'user-1' })
    expect(sqlite.prepare('SELECT nickname, password_hash FROM auth_registrations').get()).toEqual({
      nickname: 'Pending', password_hash: 'pending-password',
    })
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  } finally {
    sqlite.close()
  }
})
