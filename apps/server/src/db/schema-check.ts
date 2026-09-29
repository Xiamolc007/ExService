import type { SqlExecutor } from '@server/src/db/client.js'
import { getTableConfig } from 'drizzle-orm/pg-core'
import * as schemaTables from '@server/src/db/schema.js'

const tableDefinitions = [
  schemaTables.authUsers, schemaTables.authSessions, schemaTables.authSsoRequests,
  schemaTables.communityGroups, schemaTables.communityGroupMemberships,
  schemaTables.joinApplications, schemaTables.joinApplicationEmailRegistry,
  schemaTables.joinApplicationForms, schemaTables.joinApplicationAttachments,
  schemaTables.joinInvitations, schemaTables.joinEmailControls, schemaTables.joinDeliveryAttempts,
].map(getTableConfig)

// PostgreSQL's stock NAMEDATALEN allows 63 bytes per identifier. Generated
// foreign-key names can exceed that limit; the catalog stores the truncated name.
const catalogName = (name: string) => Buffer.from(name, 'utf8').subarray(0, 63).toString('utf8')

export const APPLICATION_TABLES = [
  'auth_users', 'auth_sessions', 'auth_sso_requests', 'community_groups',
  'community_group_memberships', 'join_applications', 'join_application_email_registry',
  'join_application_forms', 'join_application_attachments', 'join_invitations',
  'join_email_controls', 'join_delivery_attempts',
] as const

const expectedIndexes = tableDefinitions.flatMap(table => [
  ...table.indexes.map(index => index.config.name)
    .filter((name): name is string => name !== undefined),
  ...table.columns.filter(column => column.primary).map(() => `${table.name}_pkey`),
  ...table.columns.filter(column => column.isUnique).map(column => column.uniqueName)
    .filter((name): name is string => name !== undefined),
  ...table.primaryKeys.map(key => `${table.name}_${key.columns.map(column => column.name).join('_')}_pk`),
].map(name => `${table.name}.${catalogName(name)}`))

const expectedConstraints = tableDefinitions.flatMap(table => [
  ...table.foreignKeys.map(key => key.getName()),
  ...table.checks.map(check => check.name),
  ...table.columns.filter(column => column.primary).map(() => `${table.name}_pkey`),
  ...table.columns.filter(column => column.isUnique).map(column => column.uniqueName)
    .filter((name): name is string => name !== undefined),
  ...table.primaryKeys.map(key => `${table.name}_${key.columns.map(column => column.name).join('_')}_pk`),
].map(name => `${table.name}.${catalogName(name)}`))

// Canonical PostgreSQL deparse signatures from the approved baseline migration.
// Names alone do not prove an index or constraint still enforces the same rule.
export const BASELINE_CONSTRAINT_DEFINITIONS = new Map<string, string>([
  ["auth_sessions.auth_sessions_pkey", "PRIMARY KEY (token_hash)"],
  ["auth_sessions.auth_sessions_user_id_auth_users_id_fk", "FOREIGN KEY (user_id) REFERENCES auth_users(id)"],
  ["auth_sso_requests.auth_sso_requests_pkey", "PRIMARY KEY (id_hash)"],
  ["auth_sso_requests.auth_sso_requests_status_check", "CHECK (status = ANY (ARRAY['pending'::text, 'completed'::text]))"],
  ["auth_sso_requests.auth_sso_requests_user_id_auth_users_id_fk", "FOREIGN KEY (user_id) REFERENCES auth_users(id)"],
  ["auth_users.auth_users_email_unique", "UNIQUE (email)"],
  ["auth_users.auth_users_pkey", "PRIMARY KEY (id)"],
  ["community_group_memberships.community_group_memberships_group_code_community_groups_code_fk", "FOREIGN KEY (group_code) REFERENCES community_groups(code)"],
  ["community_group_memberships.community_group_memberships_user_id_auth_users_id_fk", "FOREIGN KEY (user_id) REFERENCES auth_users(id)"],
  ["community_group_memberships.community_group_memberships_user_id_group_code_pk", "PRIMARY KEY (user_id, group_code)"],
  ["community_groups.community_groups_pkey", "PRIMARY KEY (code)"],
  ["join_application_attachments.join_application_attachments_application_id_join_applications_i", "FOREIGN KEY (application_id) REFERENCES join_applications(id) ON UPDATE RESTRICT ON DELETE RESTRICT"],
  ["join_application_attachments.join_application_attachments_length_check", "CHECK (byte_length >= 1 AND byte_length <= 10485760 AND byte_length = octet_length(bytes))"],
  ["join_application_attachments.join_application_attachments_ordinal_check", "CHECK (ordinal >= 0 AND ordinal <= 4)"],
  ["join_application_attachments.join_application_attachments_pkey", "PRIMARY KEY (id)"],
  ["join_application_attachments.join_application_attachments_sha256_check", "CHECK (sha256 ~ '^[0-9a-f]{64}$'::text)"],
  ["join_application_email_registry.join_application_email_registry_application_email_fk", "FOREIGN KEY (canonical_application_id, email) REFERENCES join_applications(id, email) ON UPDATE RESTRICT ON DELETE RESTRICT"],
  ["join_application_email_registry.join_application_email_registry_pkey", "PRIMARY KEY (email)"],
  ["join_application_forms.join_application_forms_application_id_join_applications_id_fk", "FOREIGN KEY (application_id) REFERENCES join_applications(id) ON UPDATE RESTRICT ON DELETE RESTRICT"],
  ["join_application_forms.join_application_forms_pkey", "PRIMARY KEY (application_id)"],
  ["join_application_forms.join_application_forms_type_check", "CHECK (application_type = ANY (ARRAY['new'::text, 'experienced'::text]))"],
  ["join_application_forms.join_application_forms_version_check", "CHECK (version = 1)"],
  ["join_applications.join_applications_form_version_check", "CHECK (form_version = ANY (ARRAY[0, 1]))"],
  ["join_applications.join_applications_pkey", "PRIMARY KEY (id)"],
  ["join_applications.join_applications_review_check", "CHECK (status = 'pending'::text AND reviewed_at IS NULL OR status <> 'pending'::text AND reviewed_at IS NOT NULL)"],
  ["join_applications.join_applications_reviewed_by_user_id_auth_users_id_fk", "FOREIGN KEY (reviewed_by_user_id) REFERENCES auth_users(id)"],
  ["join_applications.join_applications_status_check", "CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))"],
  ["join_delivery_attempts.join_delivery_attempts_finished_check", "CHECK (status = 'pending'::text AND finished_at IS NULL OR status <> 'pending'::text AND finished_at IS NOT NULL)"],
  ["join_delivery_attempts.join_delivery_attempts_invitation_id_join_invitations_id_fk", "FOREIGN KEY (invitation_id) REFERENCES join_invitations(id)"],
  ["join_delivery_attempts.join_delivery_attempts_pkey", "PRIMARY KEY (id)"],
  ["join_delivery_attempts.join_delivery_attempts_status_check", "CHECK (status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text]))"],
  ["join_email_controls.join_email_controls_failures_check", "CHECK (failed_attempts >= 0 AND failed_attempts <= 5)"],
  ["join_email_controls.join_email_controls_pkey", "PRIMARY KEY (email)"],
  ["join_invitations.join_invitations_application_id_join_applications_id_fk", "FOREIGN KEY (application_id) REFERENCES join_applications(id)"],
  ["join_invitations.join_invitations_completed_user_id_auth_users_id_fk", "FOREIGN KEY (completed_user_id) REFERENCES auth_users(id)"],
  ["join_invitations.join_invitations_completion_check", "CHECK (status = 'completed'::text AND completed_user_id IS NOT NULL AND completed_at IS NOT NULL OR status <> 'completed'::text AND completed_user_id IS NULL AND completed_at IS NULL)"],
  ["join_invitations.join_invitations_pkey", "PRIMARY KEY (id)"],
  ["join_invitations.join_invitations_status_check", "CHECK (status = ANY (ARRAY['active'::text, 'expired'::text, 'completed'::text]))"],
  ["join_invitations.join_invitations_version_check", "CHECK (code_version >= 1)"],
])

// The signature omits only the index name and qualified table, which are checked
// separately. It retains uniqueness, access method, columns and any predicate.
export const BASELINE_INDEX_SIGNATURES = new Map<string, string>([
  ["auth_sessions.auth_sessions_expires_at_idx", "btree (expires_at)"],
  ["auth_sessions.auth_sessions_pkey", "UNIQUE btree (token_hash)"],
  ["auth_sessions.auth_sessions_user_id_idx", "btree (user_id)"],
  ["auth_sso_requests.auth_sso_requests_expires_at_idx", "btree (expires_at)"],
  ["auth_sso_requests.auth_sso_requests_pkey", "UNIQUE btree (id_hash)"],
  ["auth_users.auth_users_avatar_key_unique", "UNIQUE btree (avatar_key)"],
  ["auth_users.auth_users_email_unique", "UNIQUE btree (email)"],
  ["auth_users.auth_users_pkey", "UNIQUE btree (id)"],
  ["community_group_memberships.community_group_memberships_user_id_group_code_pk", "UNIQUE btree (user_id, group_code)"],
  ["community_groups.community_groups_pkey", "UNIQUE btree (code)"],
  ["join_application_attachments.join_application_attachments_ordinal_unique", "UNIQUE btree (application_id, ordinal)"],
  ["join_application_attachments.join_application_attachments_pkey", "UNIQUE btree (id)"],
  ["join_application_email_registry.join_application_email_registry_pkey", "UNIQUE btree (email)"],
  ["join_application_forms.join_application_forms_pkey", "UNIQUE btree (application_id)"],
  ["join_applications.join_applications_email_history_idx", "btree (email, created_at, id)"],
  ["join_applications.join_applications_id_email_unique", "UNIQUE btree (id, email)"],
  ["join_applications.join_applications_list_idx", "btree (status, created_at, id)"],
  ["join_applications.join_applications_open_email_unique", "UNIQUE btree (email) WHERE (status = ANY (ARRAY['pending'::text, 'approved'::text]))"],
  ["join_applications.join_applications_pkey", "UNIQUE btree (id)"],
  ["join_delivery_attempts.join_delivery_attempts_pkey", "UNIQUE btree (id)"],
  ["join_delivery_attempts.join_delivery_attempts_version_unique", "UNIQUE btree (invitation_id, code_version)"],
  ["join_email_controls.join_email_controls_pkey", "UNIQUE btree (email)"],
  ["join_invitations.join_invitations_active_application_unique", "UNIQUE btree (application_id) WHERE (status = 'active'::text)"],
  ["join_invitations.join_invitations_application_idx", "btree (application_id, issued_at, id)"],
  ["join_invitations.join_invitations_completion_token_unique", "UNIQUE btree (completion_token_hash)"],
  ["join_invitations.join_invitations_expires_idx", "btree (expires_at)"],
  ["join_invitations.join_invitations_pkey", "UNIQUE btree (id)"],
])

export function indexSignature(definition: string): string {
  const match = /^CREATE (UNIQUE )?INDEX \S+ ON \S+ USING (.+)$/.exec(definition)
  return match ? `${match[1] ?? ''}${match[2]}` : definition
}

export async function assertDatabaseReady(db: SqlExecutor, schema = 'public', migrationsSchema = 'drizzle'): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema) || !/^[a-z_][a-z0-9_]*$/.test(migrationsSchema)) {
    throw new Error('无效的 Server schema 名称。')
  }
  const tables = await db.query<{ tablename: string }>(
    'SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = $1', [schema])
  const found = new Set(tables.rows.map(row => row.tablename))
  const missing = APPLICATION_TABLES.filter(table => !found.has(table))
  if (missing.length) throw new Error(`Server 数据表缺失（${missing.join(', ')}）；请运行 pnpm db:migrate。`)

  const columns = await db.query<{
    table_name: string; column_name: string; data_type: string; is_nullable: 'YES' | 'NO'
  }>(`SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = ANY($2::text[])`, [schema, APPLICATION_TABLES])
  const actualColumns = new Map<string, Map<string, { type: string; nullable: boolean }>>()
  for (const column of columns.rows) {
    const table = actualColumns.get(column.table_name) ?? new Map()
    table.set(column.column_name, { type: column.data_type, nullable: column.is_nullable === 'YES' })
    actualColumns.set(column.table_name, table)
  }
  for (const table of tableDefinitions) {
    const actual = actualColumns.get(table.name) ?? new Map()
    if (actual.size !== table.columns.length || table.columns.some(column => {
      const stored = actual.get(column.name)
      return !stored || stored.type !== column.getSQLType() || stored.nullable === column.notNull
    })) {
      throw new Error(`Server 数据表结构不完整（${table.name}）；请人工核查 migration。`)
    }
  }

  const indexes = await db.query<{
    tablename: string; indexname: string; indexdef: string
    indisvalid: boolean; indisready: boolean; indislive: boolean
  }>(`SELECT t.relname AS tablename, i.relname AS indexname,
      pg_catalog.pg_get_indexdef(i.oid) AS indexdef,
      x.indisvalid, x.indisready, x.indislive
    FROM pg_catalog.pg_index x
    JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid
    JOIN pg_catalog.pg_class t ON t.oid = x.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = $1`, [schema])
  const actualIndexes = new Set(indexes.rows.map(row => `${row.tablename}.${row.indexname}`))
  const missingIndexes = expectedIndexes.filter(index => !actualIndexes.has(index))
  if (missingIndexes.length) throw new Error(`Server 索引缺失（${missingIndexes.join(', ')}）；请运行 pnpm db:migrate。`)
  const changedIndexes = indexes.rows.filter(row => {
    const expected = BASELINE_INDEX_SIGNATURES.get(`${row.tablename}.${row.indexname}`)
    return expected !== undefined && (
      indexSignature(row.indexdef) !== expected || !row.indisvalid || !row.indisready || !row.indislive
    )
  })
  if (changedIndexes.length) {
    throw new Error(`Server 索引定义与 migration 基线不一致（${changedIndexes.map(row => `${row.tablename}.${row.indexname}`).join(', ')}）；请人工核查。`)
  }

  const constraints = await db.query<{ table_name: string; conname: string; definition: string }>(`SELECT t.relname AS table_name, c.conname,
      pg_catalog.pg_get_constraintdef(c.oid, true) AS definition
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = $1`, [schema])
  const actualConstraints = new Set(constraints.rows.map(row => `${row.table_name}.${row.conname}`))
  const missingConstraints = expectedConstraints.filter(name => !actualConstraints.has(name))
  if (missingConstraints.length) throw new Error(`Server 约束缺失（${missingConstraints.join(', ')}）；请运行 pnpm db:migrate。`)
  const changedConstraints = constraints.rows.filter(row => {
    const expected = BASELINE_CONSTRAINT_DEFINITIONS.get(`${row.table_name}.${row.conname}`)
    return expected !== undefined && row.definition !== expected
  })
  if (changedConstraints.length) {
    throw new Error(`Server 约束定义与 migration 基线不一致（${changedConstraints.map(row => `${row.table_name}.${row.conname}`).join(', ')}）；请人工核查。`)
  }

  const journal = await db.query<{ tablename: string }>(
    `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = $1 AND tablename = '__drizzle_migrations'`,
    [migrationsSchema])
  if (journal.rows.length !== 1) throw new Error('Server migration 记录缺失；请运行 pnpm db:migrate。')
  const applied = await db.query(`SELECT 1 FROM "${migrationsSchema}"."__drizzle_migrations" LIMIT 1`)
  if (applied.rows.length !== 1) throw new Error('Server migration 尚未完成；请核查后显式运行 pnpm db:migrate。')

  // The caller's search_path is fixed to the same schema; no value is interpolated as SQL.
  const admin = await db.query<{ code: string }>("SELECT code FROM community_groups WHERE code = 'admin'")
  if (admin.rows.length !== 1) throw new Error('Server admin 基础记录缺失；请运行 pnpm db:migrate。')
}
