import type Database from 'better-sqlite3'

import { validateStoredJoinForm } from '@server/src/join/form-validation.js'
import type { JoinForm } from '@server/src/join/form-validation.js'

export interface ApplicationRow {
  id: string; email: string; nickname: string; qq: string
  status: 'pending' | 'approved' | 'rejected'; created_at: number; reviewed_at: number | null; reviewed_by_user_id: string | null
  form_version: 0 | 1
}
export interface InvitationRow {
  id: string; application_id: string; status: 'active' | 'expired' | 'completed'; issued_at: number; expires_at: number
  code_version: number; code_digest: string | null; code_expires_at: number | null
  completion_token_hash: string | null; completion_expires_at: number | null; completed_user_id: string | null; completed_at: number | null
}
export interface ControlRow { email: string; next_send_at: number; failure_window_started_at: number | null; failed_attempts: number }
export interface DeliveryRow { id: string; status: 'pending' | 'sent' | 'failed'; started_at: number; finished_at: number | null }
export function effectiveStatus(row: InvitationRow, now: number) {
  return row.status === 'active' && now >= row.expires_at ? 'expired' as const : row.status
}
export function application(sqlite: Database.Database, id: string) {
  return sqlite.prepare('SELECT * FROM join_applications WHERE id = ?').get(id) as ApplicationRow | undefined
}
export function latestInvitation(sqlite: Database.Database, applicationId: string) {
  return sqlite.prepare('SELECT * FROM join_invitations WHERE application_id = ? ORDER BY issued_at DESC, id DESC LIMIT 1').get(applicationId) as InvitationRow | undefined
}
export function control(sqlite: Database.Database, email: string) {
  return sqlite.prepare('SELECT * FROM join_email_controls WHERE email = ?').get(email) as ControlRow | undefined
}
export function summary(sqlite: Database.Database, row: ApplicationRow, now: number) {
  const invitation = latestInvitation(sqlite, row.id)
  const delivery = invitation && latestDelivery(sqlite, invitation.id)
  return { id: row.id, email: row.email, nickname: row.nickname, qq: row.qq, status: row.status, createdAt: row.created_at,
    reviewedAt: row.reviewed_at, reviewedByUserId: row.reviewed_by_user_id, invitationStatus: invitation ? effectiveStatus(invitation, now) : null,
    deliveryStatus: delivery?.status ?? null, applicationType: applicationForm(sqlite, row, now)?.applicationType ?? 'legacy' as const }
}
export function applicationForm(sqlite: Database.Database, row: ApplicationRow, now: number): JoinForm | null {
  const stored = sqlite.prepare('SELECT version, application_type, form_json FROM join_application_forms WHERE application_id = ?').get(row.id) as { version: number; application_type: string; form_json: string } | undefined
  if (row.form_version === 0) {
    if (stored) throw new Error('Legacy join application has a versioned form')
    return null
  }
  if (row.form_version !== 1 || !stored || stored.version !== 1) throw new Error('Join application versioned form is missing')
  let parsed: unknown
  try { parsed = JSON.parse(stored.form_json) } catch { throw new Error('Join application versioned form is invalid') }
  const form = validateStoredJoinForm(parsed, now)
  if (form.applicationType !== stored.application_type) throw new Error('Join application versioned form type is inconsistent')
  return form
}
export interface AttachmentMetadata {
  id: string; originalName: string; extension: string; byteLength: number; sha256: string; ordinal: number
}
export function attachmentMetadata(sqlite: Database.Database, row: ApplicationRow, form: JoinForm | null): AttachmentMetadata[] {
  const rows = sqlite.prepare('SELECT id, original_name, extension, byte_length, sha256, ordinal FROM join_application_attachments WHERE application_id = ? ORDER BY ordinal').all(row.id) as Array<{ id: string; original_name: string; extension: string; byte_length: number; sha256: string; ordinal: number }>
  if ((form?.applicationType !== 'experienced' && rows.length) || rows.length > 5) throw new Error('Join application attachments are inconsistent')
  return rows.map(item => ({ id: item.id, originalName: item.original_name, extension: item.extension, byteLength: item.byte_length, sha256: item.sha256, ordinal: item.ordinal }))
}
export function latestDelivery(sqlite: Database.Database, invitationId: string) {
  return sqlite.prepare('SELECT id, status, started_at, finished_at FROM join_delivery_attempts WHERE invitation_id = ? ORDER BY code_version DESC LIMIT 1').get(invitationId) as DeliveryRow | undefined
}
export function detail(sqlite: Database.Database, row: ApplicationRow, now: number) {
  const form = applicationForm(sqlite, row, now)
  const invitation = latestInvitation(sqlite, row.id)
  const delivery = invitation && latestDelivery(sqlite, invitation.id)
  return { application: summary(sqlite, row, now), invitation: invitation ? {
    id: invitation.id, status: effectiveStatus(invitation, now), issuedAt: invitation.issued_at, expiresAt: invitation.expires_at,
    codeExpiresAt: invitation.code_expires_at !== null && now < invitation.code_expires_at ? invitation.code_expires_at : null,
    completedAt: invitation.completed_at, completedUserId: invitation.completed_user_id,
    resendAvailableAt: Math.max(now, control(sqlite, row.email)?.next_send_at ?? now),
    latestDelivery: delivery ? { id: delivery.id, status: delivery.status, startedAt: delivery.started_at, finishedAt: delivery.finished_at } : null,
  } : null, serverTime: now, formVersion: row.form_version, form, attachments: attachmentMetadata(sqlite, row, form) }
}
