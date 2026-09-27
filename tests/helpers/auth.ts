import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { AuthService, type AuthServiceDependencies } from '../../apps/mock-server/src/auth/service'
import type { PasswordHasher } from '../../apps/mock-server/src/auth/crypto'
import { ProfileService } from '../../apps/mock-server/src/profile/service'
import { InvitationService, type InvitationServiceDependencies } from '../../apps/mock-server/src/invitations/service'
import type { InvitationMail } from '../../apps/mock-server/src/invitations/mail'
import { JoinService } from '../../apps/mock-server/src/join/service'
const migrationPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../apps/mock-server/drizzle')
export const testPasswordHasher: PasswordHasher = {
  async hash(password) { return `test-password:${password}` },
  async verify(password, encodedHash) { return encodedHash === `test-password:${password}` },
}
export function newJoinApplication(email = 'member@example.com', nickname = 'Applicant', qq = '001234') {
  return { email, nickname, qq, form: { applicationType: 'new' as const, birthDate: '2000-02-29', applicantCategory: '100' as const,
    department: 'leo' as const, freeTime: '每晚都有空', discoveryChannels: ['friends' as const],
    answers: { fiveMExperience: '没有接触过', emergencyRoleplayKnowledge: '了解', emergencyProceduresKnowledge: '学习中', rpUnderstanding: '扮演真实角色', frpUnderstanding: '遵循角色与场景' },
    commitments: { informationAccurate: true as const, obeyCommunityRules: true as const, acceptAcademyAttendanceConsequences: true as const } } }
}
export function experiencedJoinApplication(email = 'experienced@example.com') {
  const common = newJoinApplication(email)
  return { ...common, form: { ...common.form, applicationType: 'experienced' as const,
    answers: { previousServer: 'Previous server', leaveReason: '寻找新社区', previousDepartment: '巡逻', lawEnforcementExperience: '有相关经历', highestRank: 'Officer', punishmentHistory: '无', deescalationEssay: '😀'.repeat(150), discretionEssay: '自'.repeat(150), transferReason: '继续学习' },
    commitments: { informationAccurate: true as const } } }
}
export function createTestAuth(overrides: Partial<AuthServiceDependencies & InvitationServiceDependencies> = {}) {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const journal = JSON.parse(readFileSync(resolve(migrationPath, 'meta/_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> }
  sqlite.transaction(() => {
    for (const { tag } of journal.entries) sqlite.exec(readFileSync(resolve(migrationPath, `${tag}.sql`), 'utf8').replaceAll('--> statement-breakpoint', ''))
  })()
  let randomCounter = 0, idCounter = 0, codeCounter = 123456, userCounter = 0
  const deliveries: InvitationMail[] = []
  let currentTime = 1_800_000_000_000
  const now = overrides.now ?? (() => currentTime)
  const createId = () => `20000000-0000-4000-8000-${String(++idCounter).padStart(12,'0')}`
  const createUserId = overrides.createUserId ?? (() => `10000000-0000-4000-8000-${String(++userCounter).padStart(12,'0')}`)
  const passwordHasher = overrides.passwordHasher ?? testPasswordHasher
  const shared = {
    sqlite, now, passwordHasher,
    randomBytes: (length: number) => { const bytes = Buffer.alloc(length); bytes.writeUInt32BE(++randomCounter, Math.max(0, length - 4)); return bytes },
    ...overrides,
  }
  const authServices = new AuthService(shared)
  const invitationServices = new InvitationService({ ...shared, codeHmacKey: overrides.codeHmacKey ?? Buffer.alloc(32,7),
    createId, createUserId, randomInteger: () => codeCounter++ % 1_000_000,
    ...overrides,
    deliverInvitation: mail => { deliveries.push(mail); return overrides.deliverInvitation?.(mail) } })
  const joinServices = new JoinService(invitationServices, createId)
  const avatarDirectory = mkdtempSync(resolve(tmpdir(), 'exwebsite-avatars-'))
  const profileServices = new ProfileService(sqlite, avatarDirectory, 'http://127.0.0.1:8080/api/avatars')
  return { sqlite, authServices, invitationServices, joinServices, profileServices, avatarDirectory, deliveries, now,
    async seedUser(input: { email: string; nickname: string; password: string }) {
      const id = createUserId(), hash = await passwordHasher.hash(input.password)
      sqlite.prepare('INSERT INTO auth_users (id, email, nickname, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, input.email.trim().toLowerCase(), input.nickname.trim(), hash, now())
      return id
    },
    advance(milliseconds: number) { currentTime += milliseconds },
    close() { sqlite.close(); rmSync(avatarDirectory, {recursive:true,force:true}) },
  }
}
export async function approvedInvitation(fixture: ReturnType<typeof createTestAuth>, email = 'member@example.com') {
  fixture.joinServices.submit(newJoinApplication(email))
  const row = fixture.sqlite.prepare('SELECT id FROM join_applications WHERE email = ? AND status = ?').get(email,'pending') as { id: string }
  await fixture.joinServices.approve(row.id)
  return { id: row.id, email, code: fixture.deliveries.at(-1)!.code }
}
export async function registerInvited(fixture: ReturnType<typeof createTestAuth>, email = 'member@example.com') {
  const approved = await approvedInvitation(fixture,email)
  const grant = fixture.invitationServices.verifyCode(email, approved.code)
  return fixture.invitationServices.complete({completionToken:grant.completionToken,nickname:'Member',password:'valid password'})
}
export function joinSnapshot(fixture: ReturnType<typeof createTestAuth>) {
  return Object.fromEntries(['join_applications','join_application_email_registry','join_application_forms','join_application_attachments','join_invitations','join_email_controls','join_delivery_attempts','auth_users','auth_sessions','auth_sso_requests','community_groups','community_group_memberships']
    .map(table => [table, fixture.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
}
