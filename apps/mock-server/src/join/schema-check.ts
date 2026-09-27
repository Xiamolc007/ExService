import type Database from 'better-sqlite3'
export function assertJoinSchemaAvailable(sqlite: Database.Database): void {
  const required: Record<string, string[]> = {
    join_applications: ['id','email','nickname','qq','status','created_at','reviewed_at','reviewed_by_user_id','form_version'],
    join_application_email_registry: ['email','canonical_application_id'],
    join_application_forms: ['application_id','version','application_type','form_json'],
    join_application_attachments: ['id','application_id','ordinal','original_name','extension','sha256','byte_length','bytes'],
    join_invitations: ['id','application_id','status','issued_at','expires_at','code_version','code_digest','code_expires_at','completion_token_hash','completion_expires_at','completed_user_id','completed_at'],
    join_email_controls: ['email','next_send_at','failure_window_started_at','failed_attempts'],
    join_delivery_attempts: ['id','invitation_id','code_version','started_at','finished_at','status'],
  }
  for (const [table, columns] of Object.entries(required)) {
    const actual = new Set((sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{name: string}>).map(row => row.name))
    if (columns.some(column => !actual.has(column))) throw new Error(`加入流程结构缺失（${table}）；请运行 pnpm db:migrate。`)
  }
  for (const index of ['join_applications_open_email_unique','join_applications_email_history_idx','join_application_attachments_ordinal_unique','join_invitations_active_application_unique','join_invitations_completion_token_unique','join_delivery_attempts_version_unique']) {
    if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(index)) throw new Error(`加入流程索引缺失（${index}）；请运行 pnpm db:migrate。`)
  }
}
/** Read-only audit before the explicit 0.5 migration; includes Unicode normalization. */
export function assertJoinApplicationMigrationReady(sqlite: Database.Database): void {
  if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'join_applications'").get()) return
  const columns = sqlite.prepare('PRAGMA table_info(join_applications)').all() as Array<{ name: string }>
  if (columns.some(column => column.name === 'form_version')) return
  const invalid = (sqlite.prepare('SELECT id, email FROM join_applications').all() as Array<{ id: string; email: string }>)
    .filter(row => row.email !== row.email.trim().toLowerCase())
  const foreignKeys = sqlite.pragma('foreign_key_check') as unknown[]
  if (invalid.length || foreignKeys.length) throw new Error(`Join history migration audit failed: ${invalid.length} unnormalized application(s), ids=${invalid.map(row => row.id).join(',')}; ${foreignKeys.length} invalid foreign key(s).`)
}
