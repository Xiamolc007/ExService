import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { DATABASE_PATH, assertCliEntry, ensureDatabaseDirectory, openDatabase } from './client.js'
import { assertJoinApplicationMigrationReady } from '../join/schema-check.js'

/** 与 `client.ts` 同理：`src/db/*` 与 `dist/db/*` 都解析到 `apps/mock-server/drizzle`。 */
const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle')

/**
 * 创建数据目录与 SQLite 文件，并按 Drizzle journal 应用尚未执行的 migration。
 *
 * 只做增量应用：不删除现有数据库，不接受可变的数据库路径。
 */
export function runMigrations(): void {
  ensureDatabaseDirectory()

  const { sqlite, db } = openDatabase()
  try {
    assertJoinApplicationMigrationReady(sqlite)
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  } finally {
    sqlite.close()
  }
}

assertCliEntry(import.meta.url)

runMigrations()

console.log(`[db:migrate] migrations applied to ${DATABASE_PATH}`)
