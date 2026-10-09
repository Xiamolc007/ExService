import { realpathSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool, type PoolClient, type QueryResultRow } from 'pg'

export interface SqlExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>
}

export interface AppDatabase extends SqlExecutor {
  transaction<T>(run: (tx: SqlExecutor) => Promise<T>, mode?: 'read-committed' | 'repeatable-read-read-only'): Promise<T>
  close(): Promise<void>
}

export interface DatabaseOptions {
  connectionString?: string
  /** Test isolation only. The CLI uses public and never infers a schema from an environment variable. */
  searchPath?: string
}

const safeIdentifier = /^[a-z_][a-z0-9_]*$/

export function assertDatabaseUrl(connectionString: string | undefined): string {
  if (!connectionString) throw new Error('DATABASE_URL 未配置；数据库必须明确指向 exre。')
  let url: URL
  try { url = new URL(connectionString) } catch { throw new Error('DATABASE_URL 无效。') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      decodeURIComponent(url.pathname) !== '/exre' || !url.hostname ||
      !url.username || !url.password || url.search || url.hash) {
    throw new Error('DATABASE_URL 必须明确指向独立的 exre PostgreSQL 数据库。')
  }
  return connectionString
}

export function assertCliEntry(moduleUrl: string): void {
  const selfPath = fileURLToPath(moduleUrl)
  const entry = process.argv[1]
  if (entry !== undefined) {
    try { if (realpathSync(entry) === realpathSync(selfPath)) return } catch { /* handled below */ }
  }
  throw new Error(`${basename(selfPath)} 是 CLI 入口，只能由 pnpm 脚本直接运行，不能被 import。`)
}

export function safeInteger(value: string | number, column: string): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(number)) throw new Error(`数据库整数 ${column} 超出安全范围。`)
  return number
}

const millisecondColumns = new Set([
  'created_at', 'expires_at', 'revoked_at', 'completed_at', 'reviewed_at',
  'issued_at', 'code_expires_at', 'completion_expires_at', 'next_send_at',
  'failure_window_started_at', 'started_at', 'finished_at', 'n',
])

/**
 * 持久通知的时间戳列。node-postgres 把 `bigint` 作为字符串返回，
 * 与账号/申请模块的做法一致：按列名显式转成安全整数。
 */
const notificationMillisecondColumns = new Set([
  'occurred_at', 'available_at', 'withdrawn_at', 'delivered_at', 'read_at', 'cleared_at',
  'decided_at', 'projection_lease_expires_at', 'projection_next_attempt_at',
  'projection_completed_at', 'preview_expires_at', 'applied_at', 'restored_at', 'updated_at',
])

function convertRows<Row extends QueryResultRow>(rows: Row[]): Row[] {
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (value !== null && value !== undefined &&
          (millisecondColumns.has(key) || notificationMillisecondColumns.has(key)) &&
          (typeof value === 'string' || typeof value === 'number')) {
        ;(row as QueryResultRow)[key] = safeInteger(value, key)
      }
    }
  }
  return rows
}

function executor(client: Pool | PoolClient): SqlExecutor {
  return {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, values: readonly unknown[] = []) {
      const result = await client.query<Row>(sql, [...values])
      return { rows: convertRows(result.rows), rowCount: result.rowCount }
    },
  }
}

export async function createVerifiedPool(options: DatabaseOptions = {}): Promise<Pool> {
  const connectionString = assertDatabaseUrl(options.connectionString ?? process.env.DATABASE_URL)
  const searchPath = options.searchPath ?? 'public'
  if (!safeIdentifier.test(searchPath)) {
    throw new Error('无效的 PostgreSQL schema 名称。')
  }
  // Startup options override role defaults and PGOPTIONS for every pool connection.
  const pool = new Pool({ connectionString, max: 10, options: `-c search_path=${searchPath}` })
  try {
    const identity = await pool.query<{ database_name: string; schema_name: string | null }>(
      'SELECT current_database() AS database_name, current_schema() AS schema_name')
    if (identity.rows[0]?.database_name !== 'exre') throw new Error('连接目标不是 exre 数据库。')
    if (identity.rows[0]?.schema_name !== searchPath) throw new Error('连接 schema 与预期不一致。')
  } catch (error) {
    await pool.end()
    throw error
  }
  return pool
}

export async function openDatabase(options: DatabaseOptions = {}): Promise<AppDatabase> {
  const pool = await createVerifiedPool(options)
  const queries = executor(pool)
  return {
    ...queries,
    async transaction<T>(run: (tx: SqlExecutor) => Promise<T>, mode: 'read-committed' | 'repeatable-read-read-only' = 'read-committed') {
      const client = await pool.connect()
      try {
        await client.query(mode === 'repeatable-read-read-only' ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN')
        const result = await run(executor(client))
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally { client.release() }
    },
    close: () => pool.end(),
  }
}
