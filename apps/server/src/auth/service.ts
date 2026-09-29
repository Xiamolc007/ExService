import { createHash } from 'node:crypto'
import { AuthError } from '@server/src/auth/errors.js'
import { ScryptPasswordHasher, secureRandom, type PasswordHasher } from '@server/src/auth/crypto.js'
import type { AppDatabase, SqlExecutor } from '@server/src/db/client.js'

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000
const SSO_LIFETIME_MS = 10 * 60 * 1000
const TOMBSTONE_RETENTION_MS = 24 * 60 * 60 * 1000
const DUMMY_PASSWORD_HASH = 'scrypt$v1$N=32768,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$87xuP_zsviL_8xlYE4GGdN5CefEvk9cTaJi8aTN_W93HjYfwLqp9zNpi6WxxRJHq5-2MjYVQYA-ziEFf-XFU1Q'

export interface AuthServiceDependencies {
  db: AppDatabase
  now?: () => number
  randomBytes?: (length: number) => Buffer
  passwordHasher?: PasswordHasher
}
export interface LoginInput { email: string; password: string }
export interface SessionIdentity {
  tokenHash: string; userId: string; email: string; nickname: string; expiresAt: number
}
interface UserRow { id: string; email: string; nickname: string; password_hash: string }
interface SsoRow {
  id_hash: string; created_at: number; expires_at: number; status: 'pending' | 'completed'
  user_id: string | null; completed_at: number | null
}

export class AuthService {
  private readonly db: AppDatabase
  private readonly now: () => number
  private readonly randomBytes: (length: number) => Buffer
  private readonly passwordHasher: PasswordHasher

  constructor(dependencies: AuthServiceDependencies) {
    this.db = dependencies.db
    this.now = dependencies.now ?? Date.now
    this.randomBytes = dependencies.randomBytes ?? secureRandom.bytes
    this.passwordHasher = dependencies.passwordHasher ?? new ScryptPasswordHasher()
  }

  async login(input: LoginInput) {
    const email = normalizeEmail(input.email)
    assertPassword(input.password)
    const user = await this.findUserByEmail(email)
    const valid = await this.passwordHasher.verify(input.password, user?.password_hash ?? DUMMY_PASSWORD_HASH)
    if (!user || !valid) throw new AuthError('INVALID_CREDENTIALS')
    const token = this.createOpaqueIdentifier(), now = this.now(), expiresAt = now + SESSION_LIFETIME_MS
    await this.db.query(`INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, revoked_at)
      VALUES ($1, $2, $3, $4, NULL)`, [digestOpaque(token), user.id, now, expiresAt])
    return { token, expiresAt }
  }

  async authenticateToken(token: string): Promise<SessionIdentity> {
    const now = this.now()
    const result = await this.db.query<{
      token_hash: string; user_id: string; expires_at: number; revoked_at: number | null
      email: string; nickname: string
    }>(`SELECT s.token_hash, s.user_id, s.expires_at, s.revoked_at, u.email, u.nickname
      FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id WHERE s.token_hash = $1`, [digestOpaque(token)])
    const row = result.rows[0]
    if (!row || row.revoked_at !== null || now >= row.expires_at) throw new AuthError('SESSION_INVALID')
    return { tokenHash: row.token_hash, userId: row.user_id, email: row.email, nickname: row.nickname, expiresAt: row.expires_at }
  }

  async logout(session: SessionIdentity) {
    await this.db.transaction(async tx => {
      await this.assertSessionCurrent(session, tx, true)
      const result = await tx.query('UPDATE auth_sessions SET revoked_at = $1 WHERE token_hash = $2 AND revoked_at IS NULL',
        [this.now(), session.tokenHash])
      if (result.rowCount !== 1) throw new AuthError('SESSION_INVALID')
    })
    return { status: 'signed-out' as const }
  }

  async createSsoRequest() {
    const ssoRequestId = this.createOpaqueIdentifier(), now = this.now(), expiresAt = now + SSO_LIFETIME_MS
    await this.cleanup(now)
    await this.db.query(`INSERT INTO auth_sso_requests (id_hash, created_at, expires_at, status, user_id, completed_at)
      VALUES ($1, $2, $3, 'pending', NULL, NULL)`, [digestOpaque(ssoRequestId), now, expiresAt])
    return { ssoRequestId, expiresAt }
  }

  async inspectSsoRequest(ssoRequestId: string) {
    const now = this.now(), row = await this.getSsoRequest(digestOpaque(ssoRequestId))
    if (!row) throw new AuthError('SSO_REQUEST_NOT_FOUND')
    if (now >= row.expires_at) throw new AuthError('SSO_REQUEST_EXPIRED')
    return { ssoRequestId, status: row.status, expiresAt: row.expires_at, serverTime: now }
  }

  async loginForSso(input: LoginInput & { ssoRequestId: string }) {
    const email = normalizeEmail(input.email)
    assertPassword(input.password)
    const user = await this.findUserByEmail(email)
    const valid = await this.passwordHasher.verify(input.password, user?.password_hash ?? DUMMY_PASSWORD_HASH)
    if (!user || !valid) throw new AuthError('INVALID_CREDENTIALS')
    return this.completeSsoRequest(input.ssoRequestId, user.id)
  }

  async confirmSsoWithSession(ssoRequestId: string, session: SessionIdentity) {
    return this.completeSsoRequest(ssoRequestId, session.userId, session)
  }

  async inspectSsoRequestForCli(ssoRequestId: string) {
    const row = await this.getSsoRequest(digestOpaque(ssoRequestId))
    if (!row) return { status: 'not-found' as const }
    if (row.status === 'pending' && this.now() >= row.expires_at) return { status: 'expired' as const, expiresAt: row.expires_at }
    return { status: row.status, expiresAt: row.expires_at, userId: row.user_id }
  }

  private async completeSsoRequest(ssoRequestId: string, userId: string, session?: SessionIdentity) {
    const idHash = digestOpaque(ssoRequestId)
    return this.db.transaction(async tx => {
      if (session) await this.assertSessionCurrent(session, tx, true)
      const row = await this.getSsoRequest(idHash, tx, true)
      const now = this.now()
      if (!row) throw new AuthError('SSO_REQUEST_NOT_FOUND')
      if (now >= row.expires_at) throw new AuthError('SSO_REQUEST_EXPIRED')
      if (row.status === 'completed') {
        if (row.user_id !== userId) throw new AuthError('SSO_ACCOUNT_CONFLICT')
        return { status: 'completed' as const, ssoRequestId }
      }
      const result = await tx.query(`UPDATE auth_sso_requests SET status = 'completed', user_id = $1, completed_at = $2
        WHERE id_hash = $3 AND status = 'pending'`, [userId, now, idHash])
      if (result.rowCount !== 1) throw new AuthError('SSO_ACCOUNT_CONFLICT')
      return { status: 'completed' as const, ssoRequestId }
    })
  }

  async assertSessionCurrent(session: SessionIdentity, executor: SqlExecutor = this.db, lock = false): Promise<void> {
    const result = await executor.query<{ revoked_at: number | null; expires_at: number }>(
      `SELECT revoked_at, expires_at FROM auth_sessions WHERE token_hash = $1 AND user_id = $2${lock ? ' FOR UPDATE' : ''}`,
      [session.tokenHash, session.userId])
    const row = result.rows[0]
    if (!row || row.revoked_at !== null || this.now() >= row.expires_at) throw new AuthError('SESSION_INVALID')
  }

  private async getSsoRequest(idHash: string, executor: SqlExecutor = this.db, lock = false): Promise<SsoRow | undefined> {
    const result = await executor.query<SsoRow>(`SELECT * FROM auth_sso_requests WHERE id_hash = $1${lock ? ' FOR UPDATE' : ''}`, [idHash])
    return result.rows[0]
  }
  private async findUserByEmail(email: string): Promise<UserRow | undefined> {
    return (await this.db.query<UserRow>('SELECT * FROM auth_users WHERE email = $1', [email])).rows[0]
  }
  private async cleanup(now: number): Promise<void> {
    await this.db.query('DELETE FROM auth_sessions WHERE expires_at <= $1 OR revoked_at IS NOT NULL', [now])
    await this.db.query('DELETE FROM auth_sso_requests WHERE expires_at + $1 <= $2', [TOMBSTONE_RETENTION_MS, now])
  }
  private createOpaqueIdentifier(): string { return this.randomBytes(32).toString('base64url') }
}

export async function assertAuthSchemaAvailable(db: SqlExecutor): Promise<void> {
  const result = await db.query<{ tablename: string }>(`SELECT tablename FROM pg_catalog.pg_tables
    WHERE schemaname = current_schema() AND tablename = ANY($1::text[])`,
    [['auth_users', 'auth_sessions', 'auth_sso_requests']])
  if (result.rows.length !== 3) throw new Error('认证数据表缺失；请运行 pnpm db:migrate。')
}

function digestOpaque(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex') }
function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase()
  if (Array.from(email).length > 254) throw new AuthError('BAD_REQUEST')
  return email
}
function assertPassword(password: string): void {
  const length = Array.from(password).length
  if (length < 8 || length > 64) throw new AuthError('BAD_REQUEST')
}
