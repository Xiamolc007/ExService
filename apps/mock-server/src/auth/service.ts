import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { AuthError } from './errors.js'
import { ScryptPasswordHasher, secureRandom, type PasswordHasher } from './crypto.js'

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000
const SSO_LIFETIME_MS = 10 * 60 * 1000
const TOMBSTONE_RETENTION_MS = 24 * 60 * 60 * 1000
const DUMMY_PASSWORD_HASH = 'scrypt$v1$N=32768,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$87xuP_zsviL_8xlYE4GGdN5CefEvk9cTaJi8aTN_W93HjYfwLqp9zNpi6WxxRJHq5-2MjYVQYA-ziEFf-XFU1Q'

export interface AuthServiceDependencies {
  sqlite: Database.Database
  now?: () => number
  randomBytes?: (length: number) => Buffer
  passwordHasher?: PasswordHasher
}

export interface LoginInput {
  email: string
  password: string
}

export interface SessionIdentity {
  tokenHash: string
  userId: string
  email: string
  nickname: string
  expiresAt: number
}

interface UserRow {
  id: string
  email: string
  nickname: string
  password_hash: string
}

interface SsoRow {
  id_hash: string
  created_at: number
  expires_at: number
  status: 'pending' | 'completed'
  user_id: string | null
  completed_at: number | null
}

export class AuthService {
  private readonly sqlite: Database.Database
  private readonly now: () => number
  private readonly randomBytes: (length: number) => Buffer
  private readonly passwordHasher: PasswordHasher

  constructor(dependencies: AuthServiceDependencies) {
    this.sqlite = dependencies.sqlite
    this.now = dependencies.now ?? Date.now
    this.randomBytes = dependencies.randomBytes ?? secureRandom.bytes
    this.passwordHasher = dependencies.passwordHasher ?? new ScryptPasswordHasher()
  }

  async login(input: LoginInput) {
    const email = normalizeEmail(input.email)
    assertPassword(input.password)
    const user = this.findUserByEmail(email)
    const valid = await this.passwordHasher.verify(
      input.password,
      user?.password_hash ?? DUMMY_PASSWORD_HASH,
    )
    if (user === undefined || !valid) {
      throw new AuthError('INVALID_CREDENTIALS')
    }

    const token = this.createOpaqueIdentifier()
    const now = this.now()
    const expiresAt = now + SESSION_LIFETIME_MS
    this.sqlite.prepare(`
      INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, revoked_at)
      VALUES (?, ?, ?, ?, NULL)
    `).run(digestOpaque(token), user.id, now, expiresAt)
    return { token, expiresAt }
  }

  authenticateToken(token: string): SessionIdentity {
    const now = this.now()
    const row = this.sqlite.prepare(`
      SELECT s.token_hash, s.user_id, s.expires_at, s.revoked_at, u.email, u.nickname
      FROM auth_sessions s
      JOIN auth_users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `).get(digestOpaque(token)) as {
      token_hash: string
      user_id: string
      expires_at: number
      revoked_at: number | null
      email: string
      nickname: string
    } | undefined

    if (row === undefined || row.revoked_at !== null || now >= row.expires_at) {
      throw new AuthError('SESSION_INVALID')
    }
    return {
      tokenHash: row.token_hash,
      userId: row.user_id,
      email: row.email,
      nickname: row.nickname,
      expiresAt: row.expires_at,
    }
  }

  logout(session: SessionIdentity) {
    this.assertSessionCurrent(session)
    this.sqlite.prepare(`UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`)
      .run(this.now(), session.tokenHash)
    return { status: 'signed-out' as const }
  }

  createSsoRequest() {
    const ssoRequestId = this.createOpaqueIdentifier()
    const now = this.now()
    this.cleanup(now)
    const expiresAt = now + SSO_LIFETIME_MS
    this.sqlite.prepare(`
      INSERT INTO auth_sso_requests (id_hash, created_at, expires_at, status, user_id, completed_at)
      VALUES (?, ?, ?, 'pending', NULL, NULL)
    `).run(digestOpaque(ssoRequestId), now, expiresAt)
    return { ssoRequestId, expiresAt }
  }

  inspectSsoRequest(ssoRequestId: string) {
    const now = this.now()
    const row = this.getSsoRequest(digestOpaque(ssoRequestId))
    if (row === undefined) {
      throw new AuthError('SSO_REQUEST_NOT_FOUND')
    }
    if (now >= row.expires_at) {
      throw new AuthError('SSO_REQUEST_EXPIRED')
    }
    return { ssoRequestId, status: row.status, expiresAt: row.expires_at, serverTime: now }
  }

  async loginForSso(input: LoginInput & { ssoRequestId: string }) {
    const email = normalizeEmail(input.email)
    assertPassword(input.password)
    const user = this.findUserByEmail(email)
    const valid = await this.passwordHasher.verify(input.password, user?.password_hash ?? DUMMY_PASSWORD_HASH)
    if (user === undefined || !valid) {
      throw new AuthError('INVALID_CREDENTIALS')
    }
    return this.completeSsoRequest(input.ssoRequestId, user.id)
  }

  confirmSsoWithSession(ssoRequestId: string, session: SessionIdentity) {
    this.assertSessionCurrent(session)
    return this.completeSsoRequest(ssoRequestId, session.userId)
  }

  inspectSsoRequestForCli(ssoRequestId: string) {
    const row = this.getSsoRequest(digestOpaque(ssoRequestId))
    if (row === undefined) {
      return { status: 'not-found' as const }
    }
    if (row.status === 'pending' && this.now() >= row.expires_at) {
      return { status: 'expired' as const, expiresAt: row.expires_at }
    }
    return { status: row.status, expiresAt: row.expires_at, userId: row.user_id }
  }

  private completeSsoRequest(ssoRequestId: string, userId: string) {
    const idHash = digestOpaque(ssoRequestId)
    const now = this.now()
    const result = this.sqlite.transaction(() => {
      const row = this.getSsoRequest(idHash)
      if (row === undefined) {
        throw new AuthError('SSO_REQUEST_NOT_FOUND')
      }
      if (now >= row.expires_at) {
        throw new AuthError('SSO_REQUEST_EXPIRED')
      }
      if (row.status === 'completed') {
        if (row.user_id !== userId) {
          throw new AuthError('SSO_ACCOUNT_CONFLICT')
        }
        return { status: 'completed' as const, ssoRequestId }
      }
      this.sqlite.prepare(`
        UPDATE auth_sso_requests SET status = 'completed', user_id = ?, completed_at = ?
        WHERE id_hash = ? AND status = 'pending'
      `).run(userId, now, idHash)
      return { status: 'completed' as const, ssoRequestId }
    })()
    return result
  }

  assertSessionCurrent(session: SessionIdentity): void {
    const row = this.sqlite.prepare(`
      SELECT revoked_at, expires_at FROM auth_sessions WHERE token_hash = ? AND user_id = ?
    `).get(session.tokenHash, session.userId) as { revoked_at: number | null; expires_at: number } | undefined
    if (row === undefined || row.revoked_at !== null || this.now() >= row.expires_at) {
      throw new AuthError('SESSION_INVALID')
    }
  }

  private getSsoRequest(idHash: string): SsoRow | undefined {
    return this.sqlite.prepare(`SELECT * FROM auth_sso_requests WHERE id_hash = ?`).get(idHash) as SsoRow | undefined
  }

  private findUserByEmail(email: string): UserRow | undefined {
    return this.sqlite.prepare(`SELECT * FROM auth_users WHERE email = ?`).get(email) as UserRow | undefined
  }

  private cleanup(now: number): void {
    this.sqlite.prepare(`DELETE FROM auth_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL`).run(now)
    this.sqlite.prepare(`
      DELETE FROM auth_sso_requests
      WHERE expires_at + ? <= ?
    `).run(TOMBSTONE_RETENTION_MS, now)
  }

  private createOpaqueIdentifier(): string {
    return this.randomBytes(32).toString('base64url')
  }


}

export function assertAuthSchemaAvailable(sqlite: Database.Database): void {
  const required = [
    'auth_users',
    'auth_sessions',
    'auth_sso_requests',
  ]
  const rows = sqlite.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'auth_%'
  `).all() as Array<{ name: string }>
  const available = new Set(rows.map((row) => row.name))
  const missing = required.filter((name) => !available.has(name))
  if (missing.length > 0) {
    throw new Error(`认证数据表缺失（${missing.join(', ')}）；请运行 pnpm db:migrate。`)
  }
}

function digestOpaque(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase()
  if (Array.from(email).length > 254) {
    throw new AuthError('BAD_REQUEST')
  }
  return email
}

function assertPassword(password: string): void {
  const length = Array.from(password).length
  if (length < 8 || length > 64) {
    throw new AuthError('BAD_REQUEST')
  }
}
