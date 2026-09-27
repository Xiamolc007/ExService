import { randomUUID } from 'node:crypto'
import { AuthError } from '../auth/errors.js'
import { InvitationService, normalizeEmail, normalizeNickname } from '../invitations/service.js'
import { application, detail, latestInvitation, summary, type ApplicationRow } from './records.js'
export interface JoinApplicationInput { email: string; nickname: string; qq: string }
export class JoinService {
  constructor(private readonly invitations: InvitationService, private readonly createId: () => string = randomUUID) {}
  private get sqlite() { return this.invitations.sqlite }
  submit(input: JoinApplicationInput) {
    const email = normalizeEmail(input.email), nickname = normalizeNickname(input.nickname), now = this.invitations.now()
    if (!/^[0-9]{1,20}$/.test(input.qq)) throw new AuthError('BAD_REQUEST')
    this.invitations.cleanup(now)
    this.sqlite.transaction(() => {
      if (this.invitations.hasUser(email) || this.sqlite.prepare("SELECT 1 FROM join_applications WHERE email = ? AND status IN ('pending', 'approved')").get(email)) return
      this.sqlite.prepare("INSERT INTO join_applications (id, email, nickname, qq, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)").run(this.createId(), email, nickname, input.qq, now)
    })()
    return { status: 'received' as const }
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
      this.invitations.assertCooldown(row.email, now)
      this.invitations.cleanup(now)
      return this.invitations.issueInside(row, now, latestInvitation(this.sqlite, id))
    })()
    await this.invitations.dispatch(mail)
    return detail(this.sqlite, this.require(id), this.invitations.now())
  }
  private require(id: string) { const row = application(this.sqlite, id); if (!row) throw new AuthError('JOIN_APPLICATION_NOT_FOUND'); return row }
}
