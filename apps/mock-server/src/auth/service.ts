import { createHash, createHmac, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { AuthError } from './errors.js'
import { ScryptPasswordHasher, secureRandom, type PasswordHasher } from './crypto.js'

const CODE_LIFETIME_MS = 10 * 60 * 1000
const RESEND_DELAY_MS = 60 * 1000
const REGISTRATION_RETENTION_MS = 24 * 60 * 60 * 1000
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000
const SSO_LIFETIME_MS = 10 * 60 * 1000
const TOMBSTONE_RETENTION_MS = 24 * 60 * 60 * 1000
const DUMMY_PASSWORD_HASH = 'scrypt$v1$N=32768,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$87xuP_zsviL_8xlYE4GGdN5CefEvk9cTaJi8aTN_W93HjYfwLqp9zNpi6WxxRJHq5-2MjYVQYA-ziEFf-XFU1Q'

export interface AuthServiceDependencies {
  sqlite: Database.Database
  codeHmacKey: Buffer
  now?: () => number
  randomBytes?: (length: number) => Buffer
  randomInteger?: (maximum: number) => number
  createUserId?: () => string
  passwordHasher?: PasswordHasher
  deliverVerificationCode?: (email: string, code: string) => void | Promise<void>
}

export interface RegistrationInput {
  email: string
  nickname: string
  password: string
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

interface RegistrationRow {
  id_hash: string
  email: string
  nickname: string | null
  password_hash: string | null
  code_digest: string | null
  status: 'pending' | 'completed' | 'cancelled' | 'expired'
  failed_attempts: number
  last_sent_at: number
  code_expires_at: number
  retain_until: number
  completed_user_id: string | null
  completed_at: number | null
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
  private readonly codeHmacKey: Buffer
  private readonly now: () => number
  private readonly randomBytes: (length: number) => Buffer
  private readonly randomInteger: (maximum: number) => number
  private readonly createUserId: () => string
  private readonly passwordHasher: PasswordHasher
  private readonly deliverVerificationCode: (email: string, code: string) => void | Promise<void>

  constructor(dependencies: AuthServiceDependencies) {
    this.sqlite = dependencies.sqlite
    this.codeHmacKey = dependencies.codeHmacKey
    this.now = dependencies.now ?? Date.now
    this.randomBytes = dependencies.randomBytes ?? secureRandom.bytes
    this.randomInteger = dependencies.randomInteger ?? secureRandom.integer
    this.createUserId = dependencies.createUserId ?? randomUUID
    this.passwordHasher = dependencies.passwordHasher ?? new ScryptPasswordHasher()
    this.deliverVerificationCode = dependencies.deliverVerificationCode ?? ((email, code) => {
      console.info(`[mock-mail] verification code for ${email}: ${code}`)
    })
  }

  async startRegistration(input: RegistrationInput) {
    const normalized = normalizeRegistrationInput(input)
    const now = this.now()
    this.cleanup(now)
    this.assertUserFieldsAvailable(normalized.email)
    this.assertEmailDeliveryAvailable(normalized.email, now)

    const passwordHash = await this.passwordHasher.hash(normalized.password)
    const registrationId = this.createOpaqueIdentifier()
    const idHash = digestOpaque(registrationId)
    const code = this.createVerificationCode()
    const codeDigest = this.digestCode(idHash, code)

    const write = this.sqlite.transaction(() => {
      this.assertUserFieldsAvailable(normalized.email)
      this.assertEmailDeliveryAvailable(normalized.email, now)
      this.sqlite.prepare(`
        INSERT INTO auth_registrations (
          id_hash, email, nickname, password_hash, code_digest, status,
          failed_attempts, last_sent_at, code_expires_at, retain_until
        ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
      `).run(
        idHash,
        normalized.email,
        normalized.nickname,
        passwordHash,
        codeDigest,
        now,
        now + CODE_LIFETIME_MS,
        now + REGISTRATION_RETENTION_MS,
      )
      this.sqlite.prepare(`
        INSERT INTO auth_email_delivery (email, next_send_at) VALUES (?, ?)
        ON CONFLICT(email) DO UPDATE SET next_send_at = excluded.next_send_at
      `).run(normalized.email, now + RESEND_DELAY_MS)
    })
    write()

    await this.deliverVerificationCode(normalized.email, code)
    return challenge(registrationId, normalized.email, now)
  }

  async resendRegistrationCode(registrationId: string) {
    const idHash = digestOpaque(registrationId)
    const now = this.now()
    this.cleanup(now)
    const current = this.getRegistration(idHash)
    this.assertRegistrationCanResend(current, now)
    const code = this.createReplacementCode(idHash, current.code_digest)
    const digest = this.digestCode(idHash, code)

    const write = this.sqlite.transaction(() => {
      const row = this.getRegistration(idHash)
      this.assertRegistrationCanResend(row, now)
      this.sqlite.prepare(`
        UPDATE auth_registrations
        SET code_digest = ?, failed_attempts = 0, last_sent_at = ?, code_expires_at = ?, retain_until = ?
        WHERE id_hash = ? AND status = 'pending'
      `).run(digest, now, now + CODE_LIFETIME_MS, now + REGISTRATION_RETENTION_MS, idHash)
      this.sqlite.prepare(`UPDATE auth_email_delivery SET next_send_at = ? WHERE email = ?`)
        .run(now + RESEND_DELAY_MS, row.email)
    })
    write()

    await this.deliverVerificationCode(current.email, code)
    return challenge(registrationId, current.email, now)
  }

  cancelRegistration(registrationId: string) {
    const idHash = digestOpaque(registrationId)
    const now = this.now()
    const result = this.sqlite.transaction(() => {
      const row = this.getRegistration(idHash)
      if (row === undefined) {
        throw new AuthError('REGISTRATION_NOT_FOUND')
      }
      if (row.status === 'completed') {
        throw new AuthError('REGISTRATION_COMPLETED')
      }
      if (row.status === 'cancelled' || row.status === 'expired' || now >= row.retain_until) {
        if (row.status !== 'cancelled') {
          this.clearRegistration(idHash, 'cancelled')
        }
        return { status: 'cancelled' as const }
      }
      this.clearRegistration(idHash, 'cancelled')
      return { status: 'cancelled' as const }
    })()
    return result
  }

  verifyRegistration(registrationId: string, code: string) {
    const idHash = digestOpaque(registrationId)
    const now = this.now()
    const userId = this.createUserId()

    const result = this.sqlite.transaction(() => {
      const row = this.getRegistration(idHash)
      if (row === undefined) {
        return { error: new AuthError('REGISTRATION_NOT_FOUND') }
      }
      if (row.status === 'cancelled') {
        return { error: new AuthError('REGISTRATION_CANCELLED') }
      }
      if (row.status === 'expired' || now >= row.retain_until) {
        this.clearRegistration(idHash, 'expired')
        return { error: new AuthError('REGISTRATION_EXPIRED') }
      }
      if (row.status === 'completed') {
        if (now < row.code_expires_at && row.code_digest !== null && row.failed_attempts < 5) {
          if (row.code_digest === this.digestCode(idHash, code)) {
            return { value: { status: 'registered' as const, email: row.email } }
          }
          const failedAttempts = Math.min(5, row.failed_attempts + 1)
          this.sqlite.prepare(`UPDATE auth_registrations SET failed_attempts = ? WHERE id_hash = ?`)
            .run(failedAttempts, idHash)
          return {
            error: new AuthError(failedAttempts >= 5 ? 'REGISTRATION_COMPLETED' : 'CODE_INVALID'),
          }
        }
        return { error: new AuthError('REGISTRATION_COMPLETED') }
      }
      if (row.failed_attempts >= 5) {
        return { error: new AuthError('CODE_ATTEMPTS_EXHAUSTED') }
      }
      if (now >= row.code_expires_at || row.code_digest === null) {
        return { error: new AuthError('CODE_EXPIRED') }
      }
      if (row.code_digest !== this.digestCode(idHash, code)) {
        const failedAttempts = Math.min(5, row.failed_attempts + 1)
        this.sqlite.prepare(`UPDATE auth_registrations SET failed_attempts = ? WHERE id_hash = ?`)
          .run(failedAttempts, idHash)
        return {
          error: new AuthError(failedAttempts >= 5 ? 'CODE_ATTEMPTS_EXHAUSTED' : 'CODE_INVALID'),
        }
      }

      if (row.nickname === null || row.password_hash === null) {
        return { error: new AuthError('REGISTRATION_EXPIRED') }
      }
      if (this.userExistsByEmail(row.email)) {
        this.clearRegistration(idHash, 'cancelled')
        return { error: new AuthError('EMAIL_IN_USE') }
      }

      this.sqlite.prepare(`
        INSERT INTO auth_users (id, email, nickname, password_hash, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, row.email, row.nickname, row.password_hash, now)
      this.sqlite.prepare(`
        UPDATE auth_registrations
        SET status = 'completed', nickname = NULL, password_hash = NULL,
            completed_user_id = ?, completed_at = ?
        WHERE id_hash = ?
      `).run(userId, now, idHash)
      this.sqlite.prepare(`
        UPDATE auth_registrations
        SET status = 'cancelled', nickname = NULL, password_hash = NULL, code_digest = NULL
        WHERE email = ? AND status = 'pending' AND id_hash <> ?
      `).run(row.email, idHash)
      return { value: { status: 'registered' as const, email: row.email } }
    })()

    if ('error' in result) {
      throw result.error
    }
    return result.value
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

  currentUser(session: SessionIdentity) {
    this.assertSessionCurrent(session)
    return { id: session.userId, email: session.email, nickname: session.nickname }
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

  private assertSessionCurrent(session: SessionIdentity): void {
    const row = this.sqlite.prepare(`
      SELECT revoked_at, expires_at FROM auth_sessions WHERE token_hash = ? AND user_id = ?
    `).get(session.tokenHash, session.userId) as { revoked_at: number | null; expires_at: number } | undefined
    if (row === undefined || row.revoked_at !== null || this.now() >= row.expires_at) {
      throw new AuthError('SESSION_INVALID')
    }
  }

  private getRegistration(idHash: string): RegistrationRow | undefined {
    return this.sqlite.prepare(`SELECT * FROM auth_registrations WHERE id_hash = ?`).get(idHash) as RegistrationRow | undefined
  }

  private getSsoRequest(idHash: string): SsoRow | undefined {
    return this.sqlite.prepare(`SELECT * FROM auth_sso_requests WHERE id_hash = ?`).get(idHash) as SsoRow | undefined
  }

  private findUserByEmail(email: string): UserRow | undefined {
    return this.sqlite.prepare(`SELECT * FROM auth_users WHERE email = ?`).get(email) as UserRow | undefined
  }

  private userExistsByEmail(email: string): boolean {
    return this.sqlite.prepare(`SELECT 1 FROM auth_users WHERE email = ?`).get(email) !== undefined
  }

  private assertUserFieldsAvailable(email: string): void {
    if (this.userExistsByEmail(email)) {
      throw new AuthError('EMAIL_IN_USE')
    }
  }

  private assertEmailDeliveryAvailable(email: string, now: number): void {
    const row = this.sqlite.prepare(`SELECT next_send_at FROM auth_email_delivery WHERE email = ?`)
      .get(email) as { next_send_at: number } | undefined
    if (row !== undefined && now < row.next_send_at) {
      throw new AuthError('CODE_RESEND_TOO_SOON', {
        retryAfterSeconds: Math.max(1, Math.ceil((row.next_send_at - now) / 1000)),
      })
    }
  }

  private assertRegistrationCanResend(row: RegistrationRow | undefined, now: number): asserts row is RegistrationRow {
    if (row === undefined) {
      throw new AuthError('REGISTRATION_NOT_FOUND')
    }
    if (row.status === 'completed') {
      throw new AuthError('REGISTRATION_COMPLETED')
    }
    if (row.status === 'cancelled') {
      throw new AuthError('REGISTRATION_CANCELLED')
    }
    if (row.status === 'expired' || now >= row.retain_until) {
      throw new AuthError('REGISTRATION_EXPIRED')
    }
    this.assertEmailDeliveryAvailable(row.email, now)
  }

  private clearRegistration(idHash: string, status: 'cancelled' | 'expired'): void {
    this.sqlite.prepare(`
      UPDATE auth_registrations
      SET status = ?, nickname = NULL, password_hash = NULL, code_digest = NULL
      WHERE id_hash = ?
    `).run(status, idHash)
  }

  private cleanup(now: number): void {
    this.sqlite.prepare(`
      UPDATE auth_registrations
      SET status = 'expired', nickname = NULL, password_hash = NULL, code_digest = NULL
      WHERE id_hash IN (
        SELECT id_hash FROM auth_registrations
        WHERE status = 'pending' AND retain_until <= ? LIMIT 100
      )
    `).run(now)
    this.sqlite.prepare(`
      DELETE FROM auth_registrations
      WHERE id_hash IN (
        SELECT id_hash FROM auth_registrations
        WHERE status <> 'pending' AND retain_until + ? <= ? LIMIT 100
      )
    `).run(TOMBSTONE_RETENTION_MS, now)
    this.sqlite.prepare(`
      UPDATE auth_registrations SET code_digest = NULL
      WHERE status = 'completed' AND code_expires_at <= ? AND code_digest IS NOT NULL
    `).run(now)
    this.sqlite.prepare(`
      DELETE FROM auth_email_delivery
      WHERE next_send_at <= ?
        AND NOT EXISTS (
          SELECT 1 FROM auth_registrations
          WHERE auth_registrations.email = auth_email_delivery.email
            AND auth_registrations.status = 'pending'
        )
    `).run(now)
    this.sqlite.prepare(`DELETE FROM auth_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL`).run(now)
    this.sqlite.prepare(`
      DELETE FROM auth_sso_requests
      WHERE expires_at + ? <= ?
    `).run(TOMBSTONE_RETENTION_MS, now)
  }

  private createOpaqueIdentifier(): string {
    return this.randomBytes(32).toString('base64url')
  }

  private createVerificationCode(): string {
    return this.randomInteger(1_000_000).toString().padStart(6, '0')
  }

  private createReplacementCode(idHash: string, previousDigest: string | null): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = this.createVerificationCode()
      if (previousDigest === null || this.digestCode(idHash, code) !== previousDigest) {
        return code
      }
    }
    throw new Error('random source repeatedly produced the previous verification code')
  }

  private digestCode(idHash: string, code: string): string {
    return createHmac('sha256', this.codeHmacKey).update(`${idHash}:${code}`).digest('hex')
  }
}

export function assertAuthSchemaAvailable(sqlite: Database.Database): void {
  const required = [
    'auth_users',
    'auth_registrations',
    'auth_email_delivery',
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

function normalizeRegistrationInput(input: RegistrationInput): RegistrationInput {
  const nickname = input.nickname.trim()
  if (Array.from(nickname).length < 1 || Array.from(nickname).length > 32) {
    throw new AuthError('BAD_REQUEST')
  }
  assertPassword(input.password)
  return { email: normalizeEmail(input.email), nickname, password: input.password }
}

function assertPassword(password: string): void {
  const length = Array.from(password).length
  if (length < 8 || length > 64) {
    throw new AuthError('BAD_REQUEST')
  }
}

function challenge(registrationId: string, email: string, serverTime: number) {
  return {
    registrationId,
    email,
    serverTime,
    codeExpiresAt: serverTime + CODE_LIFETIME_MS,
    resendAvailableAt: serverTime + RESEND_DELAY_MS,
  }
}
