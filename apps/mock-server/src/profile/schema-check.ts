import type Database from 'better-sqlite3'

export function assertProfileSchemaAvailable(sqlite: Database.Database): void {
  const columns = sqlite.pragma('table_info(auth_users)') as Array<{ name: string }>
  const available = new Set(columns.map((column) => column.name))
  if (['qq', 'fivem_id', 'avatar_key'].some((name) => !available.has(name))) {
    throw new Error('用户资料列缺失；请运行 pnpm db:migrate。')
  }
}
