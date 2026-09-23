import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

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

export const authRegistrations = sqliteTable(
  'auth_registrations',
  {
    idHash: text('id_hash').primaryKey(),
    email: text('email').notNull(),
    nickname: text('nickname'),
    passwordHash: text('password_hash'),
    codeDigest: text('code_digest'),
    status: text('status').notNull(),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lastSentAt: integer('last_sent_at').notNull(),
    codeExpiresAt: integer('code_expires_at').notNull(),
    retainUntil: integer('retain_until').notNull(),
    completedUserId: text('completed_user_id').references(() => authUsers.id),
    completedAt: integer('completed_at'),
  },
  (table) => [
    check('auth_registrations_status_check', sql`${table.status} in ('pending', 'completed', 'cancelled', 'expired')`),
    check('auth_registrations_failed_attempts_check', sql`${table.failedAttempts} between 0 and 5`),
    index('auth_registrations_email_idx').on(table.email),
    index('auth_registrations_retain_until_idx').on(table.retainUntil),
  ],
)

export const authEmailDelivery = sqliteTable('auth_email_delivery', {
  email: text('email').primaryKey(),
  nextSendAt: integer('next_send_at').notNull(),
})

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
