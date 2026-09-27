import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const authUsers = sqliteTable(
  'auth_users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    nickname: text('nickname').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: integer('created_at').notNull(),
    qq: text('qq'),
    fivemId: text('fivem_id'),
    avatarKey: text('avatar_key'),
  },
  (table) => [uniqueIndex('auth_users_avatar_key_unique').on(table.avatarKey)],
)

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id').notNull().references(() => authUsers.id),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    revokedAt: integer('revoked_at'),
  },
  (table) => [
    index('auth_sessions_user_id_idx').on(table.userId),
    index('auth_sessions_expires_at_idx').on(table.expiresAt),
  ],
)

export const authSsoRequests = sqliteTable(
  'auth_sso_requests',
  {
    idHash: text('id_hash').primaryKey(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    status: text('status').notNull(),
    userId: text('user_id').references(() => authUsers.id),
    completedAt: integer('completed_at'),
  },
  (table) => [
    check('auth_sso_requests_status_check', sql`${table.status} in ('pending', 'completed')`),
    index('auth_sso_requests_expires_at_idx').on(table.expiresAt),
  ],
)

export const communityGroups = sqliteTable('community_groups', {
  code: text('code').primaryKey(),
  displayName: text('display_name').notNull(),
})

export const communityGroupMemberships = sqliteTable(
  'community_group_memberships',
  {
    userId: text('user_id').notNull().references(() => authUsers.id),
    groupCode: text('group_code').notNull().references(() => communityGroups.code),
  },
  (table) => [primaryKey({ columns: [table.userId, table.groupCode] })],
)

export const joinApplications = sqliteTable('join_applications', {
  id: text('id').primaryKey(), email: text('email').notNull(), nickname: text('nickname').notNull(), qq: text('qq').notNull(),
  status: text('status').notNull(), createdAt: integer('created_at').notNull(), reviewedAt: integer('reviewed_at'),
  reviewedByUserId: text('reviewed_by_user_id').references(() => authUsers.id),
}, table => [
  check('join_applications_status_check', sql`${table.status} in ('pending', 'approved', 'rejected')`),
  check('join_applications_review_check', sql`(${table.status} = 'pending' and ${table.reviewedAt} is null) or (${table.status} <> 'pending' and ${table.reviewedAt} is not null)`),
  uniqueIndex('join_applications_open_email_unique').on(table.email).where(sql`${table.status} in ('pending', 'approved')`),
  index('join_applications_list_idx').on(table.status, table.createdAt, table.id),
])
export const joinInvitations = sqliteTable('join_invitations', {
  id: text('id').primaryKey(), applicationId: text('application_id').notNull().references(() => joinApplications.id),
  status: text('status').notNull(), issuedAt: integer('issued_at').notNull(), expiresAt: integer('expires_at').notNull(),
  codeVersion: integer('code_version').notNull(), codeDigest: text('code_digest'), codeExpiresAt: integer('code_expires_at'),
  completionTokenHash: text('completion_token_hash'), completionExpiresAt: integer('completion_expires_at'),
  completedUserId: text('completed_user_id').references(() => authUsers.id), completedAt: integer('completed_at'),
}, table => [
  check('join_invitations_status_check', sql`${table.status} in ('active', 'expired', 'completed')`),
  check('join_invitations_version_check', sql`${table.codeVersion} >= 1`),
  check('join_invitations_completion_check', sql`(${table.status} = 'completed' and ${table.completedUserId} is not null and ${table.completedAt} is not null) or (${table.status} <> 'completed' and ${table.completedUserId} is null and ${table.completedAt} is null)`),
  uniqueIndex('join_invitations_active_application_unique').on(table.applicationId).where(sql`${table.status} = 'active'`),
  uniqueIndex('join_invitations_completion_token_unique').on(table.completionTokenHash),
  index('join_invitations_application_idx').on(table.applicationId, table.issuedAt, table.id),
  index('join_invitations_expires_idx').on(table.expiresAt),
])
export const joinEmailControls = sqliteTable('join_email_controls', {
  email: text('email').primaryKey(), nextSendAt: integer('next_send_at').notNull(),
  failureWindowStartedAt: integer('failure_window_started_at'), failedAttempts: integer('failed_attempts').notNull().default(0),
}, table => [check('join_email_controls_failures_check', sql`${table.failedAttempts} between 0 and 5`)])
export const joinDeliveryAttempts = sqliteTable('join_delivery_attempts', {
  id: text('id').primaryKey(), invitationId: text('invitation_id').notNull().references(() => joinInvitations.id),
  codeVersion: integer('code_version').notNull(), startedAt: integer('started_at').notNull(), finishedAt: integer('finished_at'), status: text('status').notNull(),
}, table => [
  uniqueIndex('join_delivery_attempts_version_unique').on(table.invitationId, table.codeVersion),
  check('join_delivery_attempts_status_check', sql`${table.status} in ('pending', 'sent', 'failed')`),
  check('join_delivery_attempts_finished_check', sql`(${table.status} = 'pending' and ${table.finishedAt} is null) or (${table.status} <> 'pending' and ${table.finishedAt} is not null)`),
])
