import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { expect, it } from 'vitest'

function migration(name: string) {
  return readFileSync(fileURLToPath(new URL(`../../apps/mock-server/drizzle/${name}`, import.meta.url)), 'utf8')
    .replaceAll('--> statement-breakpoint', '')
}

it('removes QQ while preserving existing users, sessions, SSO and pending registrations', () => {
  const sqlite = new Database(':memory:')
  try {
    sqlite.pragma('foreign_keys = ON')
    sqlite.exec(migration('0001_auth.sql'))
    sqlite.exec(`
      INSERT INTO auth_users VALUES ('user-1', 'old@example.com', 'Existing', '12345678', 'hash', 100);
      INSERT INTO auth_sessions VALUES ('token-hash', 'user-1', 100, 1000, NULL);
      INSERT INTO auth_sso_requests VALUES ('sso-hash', 100, 1000, 'completed', 'user-1', 101);
      INSERT INTO auth_registrations (id_hash, email, nickname, qq, password_hash, code_digest, status,
        failed_attempts, last_sent_at, code_expires_at, retain_until)
      VALUES ('pending-hash', 'new@example.com', 'Pending', '23456789', 'pending-password', 'code-hash', 'pending', 0, 100, 1000, 2000);
    `)
    sqlite.transaction(() => sqlite.exec(migration('0002_remove-registration-qq.sql')))()
    expect(sqlite.prepare('SELECT * FROM auth_users').get()).toEqual({
      id: 'user-1', email: 'old@example.com', nickname: 'Existing', password_hash: 'hash', created_at: 100,
    })
    expect(sqlite.prepare('SELECT user_id FROM auth_sessions').get()).toEqual({ user_id: 'user-1' })
    expect(sqlite.prepare('SELECT user_id FROM auth_sso_requests').get()).toEqual({ user_id: 'user-1' })
    expect(sqlite.prepare('SELECT nickname, password_hash, code_digest FROM auth_registrations').get()).toEqual({
      nickname: 'Pending', password_hash: 'pending-password', code_digest: 'code-hash',
    })
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
    for (const table of ['auth_users', 'auth_registrations']) {
      expect((sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>).map(({ name }) => name)).not.toContain('qq')
    }
    sqlite.prepare('INSERT INTO auth_users (id, email, nickname, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('user-2', 'new@example.com', 'Existing', 'hash', 102)
    expect(sqlite.prepare('SELECT count(*) AS count FROM auth_users').get()).toEqual({ count: 2 })
  } finally {
    sqlite.close()
  }
})
