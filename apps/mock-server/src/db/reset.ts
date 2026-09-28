import { existsSync, rmSync } from 'node:fs'
import { DATABASE_PATH, DATABASE_SIDECAR_PATHS, assertCliEntry } from '@server/src/db/client.js'

/**
 * 受控重置：只删除固定的本地 Mock SQLite 文件及其 WAL/SHM 伴随文件。
 *
 * 不删除目录、migration、源码或任何其他工作区文件；不接受路径参数。
 */
export function resetDatabase(): string[] {
  const removed: string[] = []

  for (const filePath of [DATABASE_PATH, ...DATABASE_SIDECAR_PATHS]) {
    if (existsSync(filePath)) {
      rmSync(filePath)
      removed.push(filePath)
    }
  }

  return removed
}

// 必须在删除任何文件之前确认是直接执行，避免被 import 时误删开发数据库。
assertCliEntry(import.meta.url)

const removed = resetDatabase()

console.log(
  `[db:reset] removed ${removed.length} file(s): ${removed.length > 0 ? removed.join(', ') : 'none'}`,
)
