import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { AuthError } from '../auth/errors.js'
import { InvitationService } from '../invitations/service.js'
import { application, detail, latestInvitation, summary, type ApplicationRow } from './records.js'
import { validateJoinApplicationPayload, validateJoinQuery } from './form-validation.js'
import { validateJoinProofs, type JoinProofInput } from './attachment-validation.js'
export type { JoinApplicationInput } from './form-validation.js'
export type { JoinProofInput } from './attachment-validation.js'
export class JoinService {
  constructor(private readonly invitations: InvitationService, private readonly createId: () => string = randomUUID) {}
  private get sqlite() { return this.invitations.sqlite }
  submit(value: unknown, proofs: JoinProofInput[] = []) {
    const now = this.invitations.now(), input = validateJoinApplicationPayload(value, now)
    const attachments = validateJoinProofs(proofs, input.form.applicationType)
    const { email, nickname } = input
    try {
      this.sqlite.transaction(() => {
        if (this.sqlite.prepare('SELECT 1 FROM join_application_email_registry WHERE email = ?').get(email) || this.sqlite.prepare('SELECT 1 FROM join_applications WHERE email = ?').get(email)) throw new AuthError('JOIN_APPLICATION_EXISTS')
        if (this.invitations.hasUser(email)) throw new AuthError('EMAIL_IN_USE')
        const id = this.createId()
        this.sqlite.prepare("INSERT INTO join_applications (id, email, nickname, qq, status, created_at, form_version) VALUES (?, ?, ?, ?, 'pending', ?, 1)").run(id, email, nickname, input.qq, now)
        this.sqlite.prepare('INSERT INTO join_application_email_registry (email, canonical_application_id) VALUES (?, ?)').run(email, id)
        this.sqlite.prepare('INSERT INTO join_application_forms (application_id, version, application_type, form_json) VALUES (?, 1, ?, ?)').run(id, input.form.applicationType, JSON.stringify(input.form))
        const insert = this.sqlite.prepare('INSERT INTO join_application_attachments (id, application_id, ordinal, original_name, extension, sha256, byte_length, bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        for (const file of attachments) insert.run(this.createId(), id, file.ordinal, file.originalName, file.extension, file.sha256, file.byteLength, file.bytes)
      }).immediate()
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE' && (error.message === 'UNIQUE constraint failed: join_application_email_registry.email' || error.message === 'UNIQUE constraint failed: join_applications.email')) throw new AuthError('JOIN_APPLICATION_EXISTS')
      throw error
    }
    return { status: 'received' as const }
  }
  query(value: unknown) {
    const { email } = validateJoinQuery(value), now = this.invitations.now()
    return this.sqlite.transaction(() => {
      if (this.sqlite.prepare(`SELECT 1 FROM join_invitations i JOIN join_applications a ON a.id = i.application_id JOIN auth_users u ON u.id = i.completed_user_id WHERE a.email = ? AND i.status = 'completed' LIMIT 1`).get(email)) return { status: 'registered' as const, nextAction: 'login' as const }
      if (this.sqlite.prepare(`SELECT 1 FROM join_invitations i JOIN join_applications a ON a.id = i.application_id LEFT JOIN auth_users u ON u.id = i.completed_user_id WHERE a.email = ? AND i.status = 'completed' AND u.id IS NULL LIMIT 1`).get(email)) throw new Error('Join application completed invitation association is inconsistent')
      const row = this.sqlite.prepare('SELECT * FROM join_applications WHERE email = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(email) as ApplicationRow | undefined
      if (!row) return { status: 'not_found' as const, nextAction: 'apply' as const }
      if (row.status === 'pending') return { status: 'pending' as const, nextAction: 'wait' as const }
      if (row.status === 'rejected') return { status: 'rejected' as const, nextAction: 'contact_community' as const }
      const invitation = latestInvitation(this.sqlite, row.id)
      if (!invitation || invitation.status === 'completed' || invitation.issued_at > now) throw new Error('Join application invitation association is inconsistent')
      if (invitation.status === 'expired' || invitation.expires_at <= now) return { status: 'invitation_expired' as const, nextAction: 'contact_community' as const }
      if (invitation.status !== 'active') throw new Error('Join application invitation status is inconsistent')
      return { status: 'approved' as const, nextAction: 'register' as const }
    })()
  }
  download(applicationId: string, attachmentId: string) {
    const row = this.sqlite.prepare('SELECT f.original_name, f.bytes, f.byte_length, f.sha256 FROM join_application_attachments f JOIN join_applications a ON a.id=f.application_id WHERE f.application_id = ? AND f.id = ?').get(applicationId, attachmentId) as { original_name: string; bytes: Buffer; byte_length: number; sha256: string } | undefined
    if (!row) throw new AuthError('JOIN_ATTACHMENT_NOT_FOUND')
    if (!Buffer.isBuffer(row.bytes) || row.bytes.length !== row.byte_length || createHash('sha256').update(row.bytes).digest('hex') !== row.sha256) throw new Error('Join application attachment bytes are inconsistent')
    return { originalName: row.original_name, bytes: row.bytes, byteLength: row.byte_length, sha256: row.sha256 }
  }
  list(query: { view?: string; limit?: string; offset?: string } = {}) {
    const view = query.view ?? 'pending', limitText = query.limit ?? '20', offsetText = query.offset ?? '0'
    if (!['pending','all'].includes(view) || !/^([1-9]|[1-4][0-9]|50)$/.test(limitText) || !/^(0|[1-9][0-9]{0,8})$/.test(offsetText)) throw new AuthError('BAD_REQUEST')
    const now = this.invitations.now(), limit = Number(limitText), offset = Number(offsetText)
    this.invitations.cleanup(now)
    return this.sqlite.transaction(() => {
      const filter = view === 'pending' ? "WHERE status = 'pending'" : ''
      const rows = this.sqlite.prepare(`SELECT * FROM join_applications ${filter} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(limit, offset) as ApplicationRow[]
      const total = (this.sqlite.prepare(`SELECT count(*) AS n FROM join_applications ${filter}`).get() as { n: number }).n
      return { items: rows.map(row => summary(this.sqlite, row, now)), total, offset, limit, serverTime: now }
    })()
  }
  get(id: string) { const now = this.invitations.now(); this.invitations.cleanup(now); return this.sqlite.transaction(() => detail(this.sqlite, this.require(id), now))() }
  async approve(id: string) {
    const now = this.invitations.now()
    // A cooldown rejection and an already-approved retry must not perform lazy writes.
    const result = this.sqlite.transaction(() => {
      const row = this.require(id)
      if (row.status === 'approved') return { value: detail(this.sqlite, row, now) }
      if (row.status !== 'pending') throw new AuthError('JOIN_STATE_CONFLICT')
      detail(this.sqlite, row, now)
      if (this.invitations.hasUser(row.email)) throw new AuthError('EMAIL_IN_USE')
      this.invitations.assertCooldown(row.email, now)
      this.invitations.cleanup(now)
      this.sqlite.prepare("UPDATE join_applications SET status = 'approved', reviewed_at = ?, reviewed_by_user_id = NULL WHERE id = ? AND status = 'pending'").run(now, id)
      return { mail: this.invitations.issueInside(this.require(id), now) }
    })()
    if (result.value) return result.value
    await this.invitations.dispatch(result.mail!)
    return detail(this.sqlite, this.require(id), this.invitations.now())
  }
  reject(id: string) {
    const now = this.invitations.now()
    return this.sqlite.transaction(() => {
      const row = this.require(id)
      if (row.status === 'rejected') return detail(this.sqlite, row, now)
      if (row.status !== 'pending') throw new AuthError('JOIN_STATE_CONFLICT')
      if (this.invitations.hasUser(row.email)) throw new AuthError('EMAIL_IN_USE')
      this.invitations.cleanup(now)
      this.sqlite.prepare("UPDATE join_applications SET status = 'rejected', reviewed_at = ?, reviewed_by_user_id = NULL WHERE id = ? AND status = 'pending'").run(now, id)
      return detail(this.sqlite, this.require(id), now)
    })()
  }
  async resend(id: string) {
    const now = this.invitations.now()
    const mail = this.sqlite.transaction(() => {
      const row = this.require(id), invite = latestInvitation(this.sqlite, id)
      if (this.invitations.hasUser(row.email) || invite?.status === 'completed') throw new AuthError('EMAIL_IN_USE')
      if (row.status !== 'approved') throw new AuthError('JOIN_STATE_CONFLICT')
      detail(this.sqlite, row, now)
      this.invitations.assertCooldown(row.email, now)
      this.invitations.cleanup(now)
      return this.invitations.issueInside(row, now, latestInvitation(this.sqlite, id))
    })()
    await this.invitations.dispatch(mail)
    return detail(this.sqlite, this.require(id), this.invitations.now())
  }
  private require(id: string) { const row = application(this.sqlite, id); if (!row) throw new AuthError('JOIN_APPLICATION_NOT_FOUND'); return row }
}
