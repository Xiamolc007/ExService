import { sql } from 'drizzle-orm'
import { bigint, check, foreignKey, index, integer, pgTable, primaryKey, text, uniqueIndex, customType } from 'drizzle-orm/pg-core'

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' })

export const authUsers = pgTable(
  'auth_users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    nickname: text('nickname').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    qq: text('qq'),
    fivemId: text('fivem_id'),
    avatarKey: text('avatar_key'),
  },
  (table) => [uniqueIndex('auth_users_avatar_key_unique').on(table.avatarKey)],
)

export const authSessions = pgTable(
  'auth_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id').notNull().references(() => authUsers.id),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
    revokedAt: bigint('revoked_at', { mode: 'number' }),
  },
  (table) => [
    index('auth_sessions_user_id_idx').on(table.userId),
    index('auth_sessions_expires_at_idx').on(table.expiresAt),
  ],
)

export const authSsoRequests = pgTable(
  'auth_sso_requests',
  {
    idHash: text('id_hash').primaryKey(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
    status: text('status').notNull(),
    userId: text('user_id').references(() => authUsers.id),
    completedAt: bigint('completed_at', { mode: 'number' }),
  },
  (table) => [
    check('auth_sso_requests_status_check', sql`${table.status} in ('pending', 'completed')`),
    index('auth_sso_requests_expires_at_idx').on(table.expiresAt),
  ],
)

export const communityGroups = pgTable('community_groups', {
  code: text('code').primaryKey(),
  displayName: text('display_name').notNull(),
})

export const communityGroupMemberships = pgTable(
  'community_group_memberships',
  {
    userId: text('user_id').notNull().references(() => authUsers.id),
    groupCode: text('group_code').notNull().references(() => communityGroups.code),
  },
  (table) => [primaryKey({ columns: [table.userId, table.groupCode] })],
)

export const joinApplications = pgTable('join_applications', {
  id: text('id').primaryKey(), email: text('email').notNull(), nickname: text('nickname').notNull(), qq: text('qq').notNull(),
  status: text('status').notNull(), createdAt: bigint('created_at', { mode: 'number' }).notNull(), reviewedAt: bigint('reviewed_at', { mode: 'number' }),
  reviewedByUserId: text('reviewed_by_user_id').references(() => authUsers.id),
  formVersion: integer('form_version').notNull().default(0),
}, table => [
  check('join_applications_form_version_check', sql`${table.formVersion} in (0, 1)`),
  check('join_applications_status_check', sql`${table.status} in ('pending', 'approved', 'rejected')`),
  check('join_applications_review_check', sql`(${table.status} = 'pending' and ${table.reviewedAt} is null) or (${table.status} <> 'pending' and ${table.reviewedAt} is not null)`),
  uniqueIndex('join_applications_open_email_unique').on(table.email).where(sql`${table.status} in ('pending', 'approved')`),
  uniqueIndex('join_applications_id_email_unique').on(table.id, table.email),
  index('join_applications_list_idx').on(table.status, table.createdAt, table.id),
  index('join_applications_email_history_idx').on(table.email, table.createdAt, table.id),
])
export const joinApplicationEmailRegistry = pgTable('join_application_email_registry', {
  email: text('email').primaryKey().notNull(),
  canonicalApplicationId: text('canonical_application_id').notNull(),
}, table => [foreignKey({ columns: [table.canonicalApplicationId, table.email],
  foreignColumns: [joinApplications.id, joinApplications.email],
  name: 'join_application_email_registry_application_email_fk' }).onDelete('restrict').onUpdate('restrict')])
export const joinApplicationForms = pgTable('join_application_forms', {
  applicationId: text('application_id').primaryKey().notNull().references(() => joinApplications.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  version: integer('version').notNull(), applicationType: text('application_type').notNull(), formJson: text('form_json').notNull(),
}, table => [check('join_application_forms_version_check', sql`${table.version} = 1`),
  check('join_application_forms_type_check', sql`${table.applicationType} in ('new', 'experienced')`)])
export const joinApplicationAttachments = pgTable('join_application_attachments', {
  id: text('id').primaryKey().notNull(),
  applicationId: text('application_id').notNull().references(() => joinApplications.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  ordinal: integer('ordinal').notNull(), originalName: text('original_name').notNull(), extension: text('extension').notNull(),
  sha256: text('sha256').notNull(), byteLength: integer('byte_length').notNull(), bytes: bytea('bytes').notNull(),
}, table => [uniqueIndex('join_application_attachments_ordinal_unique').on(table.applicationId, table.ordinal),
  check('join_application_attachments_ordinal_check', sql`${table.ordinal} between 0 and 4`),
  check('join_application_attachments_length_check', sql`${table.byteLength} between 1 and 10485760 and ${table.byteLength} = octet_length(${table.bytes})`),
  check('join_application_attachments_sha256_check', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`)])
export const joinInvitations = pgTable('join_invitations', {
  id: text('id').primaryKey(), applicationId: text('application_id').notNull().references(() => joinApplications.id),
  status: text('status').notNull(), issuedAt: bigint('issued_at', { mode: 'number' }).notNull(), expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  codeVersion: integer('code_version').notNull(), codeDigest: text('code_digest'), codeExpiresAt: bigint('code_expires_at', { mode: 'number' }),
  completionTokenHash: text('completion_token_hash'), completionExpiresAt: bigint('completion_expires_at', { mode: 'number' }),
  completedUserId: text('completed_user_id').references(() => authUsers.id), completedAt: bigint('completed_at', { mode: 'number' }),
}, table => [
  check('join_invitations_status_check', sql`${table.status} in ('active', 'expired', 'completed')`),
  check('join_invitations_version_check', sql`${table.codeVersion} >= 1`),
  check('join_invitations_completion_check', sql`(${table.status} = 'completed' and ${table.completedUserId} is not null and ${table.completedAt} is not null) or (${table.status} <> 'completed' and ${table.completedUserId} is null and ${table.completedAt} is null)`),
  uniqueIndex('join_invitations_active_application_unique').on(table.applicationId).where(sql`${table.status} = 'active'`),
  uniqueIndex('join_invitations_completion_token_unique').on(table.completionTokenHash),
  index('join_invitations_application_idx').on(table.applicationId, table.issuedAt, table.id),
  index('join_invitations_expires_idx').on(table.expiresAt),
])
export const joinEmailControls = pgTable('join_email_controls', {
  email: text('email').primaryKey(), nextSendAt: bigint('next_send_at', { mode: 'number' }).notNull(),
  failureWindowStartedAt: bigint('failure_window_started_at', { mode: 'number' }), failedAttempts: integer('failed_attempts').notNull().default(0),
}, table => [check('join_email_controls_failures_check', sql`${table.failedAttempts} between 0 and 5`)])
export const joinDeliveryAttempts = pgTable('join_delivery_attempts', {
  id: text('id').primaryKey(), invitationId: text('invitation_id').notNull().references(() => joinInvitations.id),
  codeVersion: integer('code_version').notNull(), startedAt: bigint('started_at', { mode: 'number' }).notNull(), finishedAt: bigint('finished_at', { mode: 'number' }), status: text('status').notNull(),
}, table => [
  uniqueIndex('join_delivery_attempts_version_unique').on(table.invitationId, table.codeVersion),
  check('join_delivery_attempts_status_check', sql`${table.status} in ('pending', 'sent', 'failed')`),
  check('join_delivery_attempts_finished_check', sql`(${table.status} = 'pending' and ${table.finishedAt} is null) or (${table.status} <> 'pending' and ${table.finishedAt} is not null)`),
])
