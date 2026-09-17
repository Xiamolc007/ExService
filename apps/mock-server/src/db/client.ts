import { mkdirSync, realpathSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

/** `src/db/*` 与 `dist/db/*` 距包根目录同为两级，因此两种运行方式解析到同一个数据目录。 */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * 本地 Mock 数据库的固定路径。
 * 不接受任何路径参数或环境变量覆盖 —— 该数据库只服务于本地 Mock 环境，不连接 PHP/生产 MySQL。
 */
export const DATABASE_PATH = resolve(packageRoot, 'data/mock.sqlite')

/** WAL 模式下可能产生的伴随文件；`db:reset` 必须与主文件一并清理。 */
export const DATABASE_SIDECAR_PATHS = [`${DATABASE_PATH}-wal`, `${DATABASE_PATH}-shm`]

export function ensureDatabaseDirectory(): void {
  mkdirSync(dirname(DATABASE_PATH), { recursive: true })
}

/**
 * `migrate.ts` / `reset.ts` 既是 CLI 入口，又包含写入或删除本地数据库的逻辑。
 * 如果它们被当作普通模块 import，副作用会在调用方毫不知情的情况下执行
 * （`db:reset` 会直接删掉开发数据库）。
 *
 * 这里在非直接执行时**抛错**而不是静默返回：静默返回会让 `db:migrate` 变成一个
 * “退出码 0 但什么都没做”的命令，比误删更难发现。
 */
export function assertCliEntry(moduleUrl: string): void {
  const selfPath = fileURLToPath(moduleUrl)
  const entry = process.argv[1]

  if (entry !== undefined) {
    try {
      if (realpathSync(entry) === realpathSync(selfPath)) {
        return
      }
    } catch {
      // 路径不可解析时落到下面统一的显式错误。
    }
  }

  throw new Error(
    `${basename(selfPath)} 是 CLI 入口，只能由 pnpm 脚本直接运行，不能被 import。`,
  )
}

/**
 * 打开（必要时创建）本地 SQLite 文件并返回 Drizzle 句柄。
 * 调用方负责在结束时 `sqlite.close()`。
 */
export function openDatabase() {
  const sqlite = new Database(DATABASE_PATH)
  sqlite.pragma('journal_mode = WAL')

  return { sqlite, db: drizzle(sqlite) }
}
