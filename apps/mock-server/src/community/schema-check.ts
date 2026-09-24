import type Database from 'better-sqlite3'

export function assertCommunitySchemaAvailable(sqlite: Database.Database): void {
  const required = ['community_groups', 'community_group_memberships']
  const rows = sqlite.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('community_groups', 'community_group_memberships')
  `).all() as Array<{ name: string }>
  const available = new Set(rows.map((row) => row.name))
  if (required.some((name) => !available.has(name))) {
    throw new Error('社区身份组数据表缺失；请运行 pnpm db:migrate。')
  }
  if (sqlite.prepare('SELECT 1 FROM community_groups WHERE code = ?').get('admin') === undefined) {
    throw new Error('管理员社区身份组缺失；请运行 pnpm db:migrate 并检查本地数据库。')
  }
  if (sqlite.prepare('SELECT 1 FROM community_groups WHERE code = ?').get('general') !== undefined) {
    throw new Error('旧版普通社区身份组仍存在；请运行 pnpm db:migrate。')
  }
}
