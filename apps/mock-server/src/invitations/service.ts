import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type Database from 'better-sqlite3'
import { AuthError } from '../auth/errors.js'
import { ScryptPasswordHasher, secureRandom, type PasswordHasher } from '../auth/crypto.js'
import { JoinRateLimiter } from '../join/rate-limiter.js'
import { application, control, type ApplicationRow, type InvitationRow } from '../join/records.js'
import { publicWebBaseUrl, terminalInvitationMailer, type InvitationMail, type InvitationMailer } from './mail.js'
const DAY = 86_400_000
const CODE_MS = 600_000
const GRANT_MS = 1_800_000
const COOLDOWN_MS = 60_000
const DELIVERY_MS = 10_000
export interface InvitationServiceDependencies {
  sqlite: Database.Database; codeHmacKey: Buffer; passwordHasher?: PasswordHasher; now?: () => number
  randomBytes?: (length: number) => Buffer; randomInteger?: (maximum: number) => number
  createUserId?: () => string; createId?: () => string; deliverInvitation?: InvitationMailer
  publicWebBaseUrl?: string; rateLimiter?: JoinRateLimiter
}
export class InvitationService {
  readonly sqlite: Database.Database
  readonly now: () => number
  private readonly key: Buffer
  private readonly hasher: PasswordHasher
  private readonly bytes: (length: number) => Buffer
  private readonly integer: (maximum: number) => number
  private readonly userId: () => string
  private readonly id: () => string
  private readonly deliver: InvitationMailer
  private readonly baseUrl: string
  private readonly limiter: JoinRateLimiter
  constructor(deps: InvitationServiceDependencies) {
    this.sqlite = deps.sqlite; this.now = deps.now ?? Date.now; this.key = deps.codeHmacKey
    this.hasher = deps.passwordHasher ?? new ScryptPasswordHasher(); this.bytes = deps.randomBytes ?? secureRandom.bytes
    this.integer = deps.randomInteger ?? secureRandom.integer; this.userId = deps.createUserId ?? randomUUID; this.id = deps.createId ?? randomUUID
    this.deliver = deps.deliverInvitation ?? terminalInvitationMailer; this.baseUrl = publicWebBaseUrl(deps.publicWebBaseUrl)
    this.limiter = deps.rateLimiter ?? new JoinRateLimiter(this.now)
  }
  limit(ip: string) {
    const retryAfterSeconds = this.limiter.check(ip)
    if (retryAfterSeconds !== undefined) throw new AuthError('JOIN_RATE_LIMITED', { retryAfterSeconds })
  }
  checkEligibility(emailInput: string) {
    const email = normalizeEmail(emailInput), now = this.now()
    return this.sqlite.transaction(() => {
      if (!this.sqlite.prepare('SELECT 1 FROM join_applications WHERE email = ?').get(email)) throw new AuthError('INVITATION_APPLICATION_NOT_FOUND')
      if (!this.eligible(email, now)) throw new AuthError('INVITATION_NOT_ELIGIBLE')
      return { status: 'eligible' as const, email, serverTime: now, resendAvailableAt: Math.max(now, control(this.sqlite, email)?.next_send_at ?? now) }
    })()
  }
  async requestCode(emailInput: string) {
    const email = normalizeEmail(emailInput), now = this.now()
    this.cleanup(now)
    const mail = this.sqlite.transaction(() => {
      const invite = this.eligible(email, now)
      if (!invite || (control(this.sqlite, email)?.next_send_at ?? 0) > now) return undefined
      return this.issueInside(application(this.sqlite, invite.application_id)!, now, invite)
    })()
    if (mail) await this.dispatch(mail)
    return { status: 'accepted' as const, serverTime: now, resendAvailableAt: now + COOLDOWN_MS }
  }
  verifyCode(emailInput: string, code: string) {
    const email = normalizeEmail(emailInput), now = this.now()
    if (!/^[0-9]{6}$/.test(code)) throw new AuthError('BAD_REQUEST')
    this.cleanup(now)
    const result = this.sqlite.transaction(() => {
      let state = control(this.sqlite, email)
      if (state?.failure_window_started_at !== null && state?.failure_window_started_at !== undefined && now >= state.failure_window_started_at + CODE_MS) {
        this.sqlite.prepare('UPDATE join_email_controls SET failed_attempts = 0, failure_window_started_at = NULL WHERE email = ?').run(email)
        state = control(this.sqlite, email)
      }
      if (state && state.failed_attempts >= 5 && state.failure_window_started_at !== null) return { error: this.locked(state.failure_window_started_at, now) }
      const invite = this.eligible(email, now)
      if (!invite) return { error: this.recordFailure(email, now) }
      if (invite.code_digest === null || invite.code_expires_at === null || now >= invite.code_expires_at) return { error: new AuthError('INVITATION_CODE_INVALID') }
      if (!equalDigest(invite.code_digest, this.digestCode(invite.id, invite.code_version, code))) return { error: this.recordFailure(email, now) }
      const token = this.bytes(32).toString('base64url'), expires = Math.min(now + GRANT_MS, invite.expires_at)
      this.sqlite.prepare(`UPDATE join_invitations SET code_digest = NULL, code_expires_at = NULL,
        completion_token_hash = ?, completion_expires_at = ? WHERE id = ?`).run(digest(token), expires, invite.id)
      const app = application(this.sqlite, invite.application_id)!
      return { value: { status: 'verified' as const, completionToken: token, email, nickname: app.nickname, serverTime: now, completionExpiresAt: expires } }
    })()
    if (result.error) throw result.error
    return result.value!
  }
  async complete(input: { completionToken: string; nickname: string; password: string }) {
    const nickname = normalizeNickname(input.nickname)
    if (Array.from(input.password).length < 8 || Array.from(input.password).length > 64 || !/^[A-Za-z0-9_-]{43}$/.test(input.completionToken)) throw new AuthError('BAD_REQUEST')
    this.cleanup(this.now())
    const hash = digest(input.completionToken)
    const preflight = this.inspectGrant(hash, this.now())
    if (preflight.invite.status === 'completed') return { status: 'registered' as const, email: preflight.app.email }
    const passwordHash = await this.hasher.hash(input.password)
    return this.sqlite.transaction(() => {
      const now = this.now(), { invite, app } = this.inspectGrant(hash, now)
      if (invite.status === 'completed') return { status: 'registered' as const, email: app.email }
      if (this.hasUser(app.email)) throw new AuthError('EMAIL_IN_USE')
      const userId = this.userId()
      this.sqlite.prepare(`INSERT INTO auth_users (id, email, nickname, password_hash, created_at, qq, fivem_id, avatar_key)
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`).run(userId, app.email, nickname, passwordHash, now, app.qq)
      this.sqlite.prepare(`UPDATE join_invitations SET status = 'completed', completed_user_id = ?, completed_at = ?,
        code_digest = NULL, code_expires_at = NULL WHERE id = ?`).run(userId, now, invite.id)
      return { status: 'registered' as const, email: app.email }
    })()
  }
  private inspectGrant(hash: string, now: number) {
    const invite = this.sqlite.prepare('SELECT * FROM join_invitations WHERE completion_token_hash = ?').get(hash) as InvitationRow | undefined
    if (!invite || invite.completion_expires_at === null || now >= invite.completion_expires_at || now < invite.issued_at || now >= invite.expires_at) throw new AuthError('COMPLETION_GRANT_INVALID')
    const app = application(this.sqlite, invite.application_id)
    if (!app || app.status !== 'approved' || (invite.status !== 'active' && invite.status !== 'completed')) throw new AuthError('COMPLETION_GRANT_INVALID')
    if (invite.status !== 'completed' && this.hasUser(app.email)) throw new AuthError('EMAIL_IN_USE')
    return { invite, app }
  }
  hasUser(email: string) { return this.sqlite.prepare('SELECT 1 FROM auth_users WHERE email = ?').get(email) !== undefined }
  eligible(email: string, now: number) {
    if (this.hasUser(email)) return undefined
    return this.sqlite.prepare(`SELECT i.* FROM join_invitations i JOIN join_applications a ON a.id = i.application_id
      WHERE a.email = ? AND a.status = 'approved' AND i.status = 'active' AND i.issued_at <= ? AND i.expires_at > ?
      AND i.completed_at IS NULL LIMIT 1`).get(email, now, now) as InvitationRow | undefined
  }
  assertCooldown(email: string, now: number) {
    const next = control(this.sqlite, email)?.next_send_at ?? 0
    if (next > now) throw new AuthError('CODE_RESEND_TOO_SOON', { retryAfterSeconds: Math.max(1, Math.ceil((next - now) / 1000)) })
  }
  /** Called only inside the caller's synchronous transaction, never awaiting delivery. */
  issueInside(app: ApplicationRow, now: number, previous?: InvitationRow): InvitationMail {
    this.assertCooldown(app.email, now)
    let invite = previous
    if (invite && (invite.status !== 'active' || now >= invite.expires_at)) {
      this.sqlite.prepare(`UPDATE join_invitations SET status = 'expired', code_digest = NULL, code_expires_at = NULL,
        completion_token_hash = NULL, completion_expires_at = NULL WHERE id = ? AND status <> 'completed'`).run(invite.id)
      invite = undefined
    }
    const id = invite?.id ?? this.id(), version = invite ? invite.code_version + 1 : 1
    let code: string | undefined
    for (let n = 0; n < 8; n++) {
      const candidate = this.integer(1_000_000).toString().padStart(6, '0')
      if (!invite?.code_digest || invite.code_expires_at === null || now >= invite.code_expires_at || !equalDigest(invite.code_digest, this.digestCode(id, invite.code_version, candidate))) { code = candidate; break }
    }
    if (code === undefined) throw new Error('random source repeatedly produced the previous verification code')
    const expires = invite?.expires_at ?? now + 7 * DAY, codeExpires = Math.min(now + CODE_MS, expires)
    if (!invite) this.sqlite.prepare(`INSERT INTO join_invitations (id, application_id, status, issued_at, expires_at, code_version, code_digest, code_expires_at)
      VALUES (?, ?, 'active', ?, ?, ?, ?, ?)`).run(id, app.id, now, expires, version, this.digestCode(id, version, code), codeExpires)
    else this.sqlite.prepare('UPDATE join_invitations SET code_version = ?, code_digest = ?, code_expires_at = ? WHERE id = ?').run(version, this.digestCode(id, version, code), codeExpires, id)
    this.sqlite.prepare(`INSERT INTO join_email_controls (email, next_send_at, failed_attempts) VALUES (?, ?, 0)
      ON CONFLICT(email) DO UPDATE SET next_send_at = excluded.next_send_at`).run(app.email, now + COOLDOWN_MS)
    const attemptId = this.id()
    this.sqlite.prepare(`INSERT INTO join_delivery_attempts (id, invitation_id, code_version, started_at, status)
      VALUES (?, ?, ?, ?, 'pending')`).run(attemptId, id, version, now)
    const url = new URL('/register', this.baseUrl); url.searchParams.set('email', app.email); url.searchParams.set('code', code)
    return { email: app.email, code, registrationUrl: url.toString(), invitationExpiresAt: expires, codeExpiresAt: codeExpires, attemptId }
  }
  async dispatch(mail: InvitationMail) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const outcome = await Promise.race([
      Promise.resolve().then(() => this.deliver(mail)).then(() => 'sent' as const, () => 'failed' as const),
      new Promise<'failed'>(resolve => { timer = setTimeout(() => resolve('failed'), DELIVERY_MS) }),
    ])
    clearTimeout(timer)
    this.sqlite.prepare(`UPDATE join_delivery_attempts SET status = ?, finished_at = ? WHERE id = ? AND status = 'pending'`).run(outcome, this.now(), mail.attemptId)
  }
  cleanup(now: number) {
    this.sqlite.prepare(`UPDATE join_invitations SET status = 'expired', code_digest = NULL, code_expires_at = NULL, completion_token_hash = NULL, completion_expires_at = NULL
      WHERE id IN (SELECT id FROM join_invitations WHERE status = 'active' AND expires_at <= ? LIMIT 25)`).run(now)
    this.sqlite.prepare(`UPDATE join_invitations SET code_digest = NULL, code_expires_at = NULL
      WHERE id IN (SELECT id FROM join_invitations WHERE code_expires_at <= ? LIMIT 25)`).run(now)
    this.sqlite.prepare(`UPDATE join_invitations SET completion_token_hash = NULL, completion_expires_at = NULL
      WHERE id IN (SELECT id FROM join_invitations WHERE completion_expires_at <= ? LIMIT 25)`).run(now)
    this.sqlite.prepare(`UPDATE join_delivery_attempts SET status = 'failed', finished_at = ?
      WHERE id IN (SELECT id FROM join_delivery_attempts WHERE status = 'pending' AND started_at + ? <= ? LIMIT 25)`).run(now, DELIVERY_MS, now)
    this.sqlite.prepare(`DELETE FROM join_email_controls WHERE email IN (SELECT c.email FROM join_email_controls c
      WHERE next_send_at <= ? AND (failure_window_started_at IS NULL OR failure_window_started_at + ? <= ?)
      AND NOT EXISTS (SELECT 1 FROM join_invitations i JOIN join_applications a ON a.id = i.application_id
        WHERE a.email = c.email AND i.status = 'active' AND i.issued_at <= ? AND i.expires_at > ?) LIMIT 25)`).run(now, CODE_MS, now, now, now)
  }
  private digestCode(id: string, version: number, code: string) { return createHmac('sha256', this.key).update(`${id}:${version}:${code}`).digest('hex') }
  private locked(startedAt: number, now: number) { return new AuthError('INVITATION_CODE_LOCKED', { retryAfterSeconds: Math.max(1, Math.ceil((startedAt + CODE_MS - now) / 1000)) }) }
  private recordFailure(email: string, now: number) {
    const existing = control(this.sqlite, email), startedAt = existing?.failure_window_started_at ?? now, attempts = Math.min(5, (existing?.failed_attempts ?? 0) + 1)
    this.sqlite.prepare(`INSERT INTO join_email_controls (email, next_send_at, failure_window_started_at, failed_attempts) VALUES (?, 0, ?, ?)
      ON CONFLICT(email) DO UPDATE SET failure_window_started_at = excluded.failure_window_started_at, failed_attempts = excluded.failed_attempts`).run(email, startedAt, attempts)
    return attempts >= 5 ? this.locked(startedAt, now) : new AuthError('INVITATION_CODE_INVALID')
  }
}
export function normalizeEmail(value: string) { const email = value.trim().toLowerCase(); if (Array.from(email).length > 254) throw new AuthError('BAD_REQUEST'); return email }
export function normalizeNickname(value: string) { const name = value.trim(); if (Array.from(name).length < 1 || Array.from(name).length > 32 || /[\u0000-\u001F\u007F-\u009F]/.test(name)) throw new AuthError('BAD_REQUEST'); return name }
function digest(value: string) { return createHash('sha256').update(value, 'utf8').digest('hex') }
function equalDigest(left: string, right: string) { const a = Buffer.from(left, 'hex'), b = Buffer.from(right, 'hex'); return a.length === b.length && timingSafeEqual(a, b) }
