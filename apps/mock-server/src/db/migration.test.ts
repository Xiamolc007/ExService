import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { expect, it } from 'vitest'
import { assertCommunitySchemaAvailable } from '../community/schema-check.js'

it('applies the full Drizzle journal and seeds admin on a fresh database', () => {
  const sqlite = new Database(':memory:')
  try {
    sqlite.pragma('foreign_keys = ON')
    migrate(drizzle(sqlite), { migrationsFolder: fileURLToPath(new URL('../../drizzle/', import.meta.url)) })
    expect(() => assertCommunitySchemaAvailable(sqlite)).not.toThrow()
    expect(sqlite.prepare('SELECT code, display_name FROM community_groups').all()).toEqual([
      { code: 'admin', display_name: '管理员' },
    ])
    expect(sqlite.prepare('SELECT * FROM community_group_memberships').all()).toEqual([])
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  } finally {
    sqlite.close()
  }
})
