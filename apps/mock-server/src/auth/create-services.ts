import type Database from 'better-sqlite3'
import { ScryptPasswordHasher } from './crypto.js'
import { AuthService } from './service.js'
import { InvitationService } from '../invitations/service.js'
import { JoinService } from '../join/service.js'

/** Pure production assembly: no database open, startup checks, migrations or writes. */
export function createAuthServices(options: {
  sqlite: Database.Database
  codeHmacKey: Buffer
  publicWebBaseUrl?: string
}) {
  const passwordHasher = new ScryptPasswordHasher()
  const authServices = new AuthService({ sqlite: options.sqlite, passwordHasher })
  const invitationServices = new InvitationService({ ...options, passwordHasher })
  const joinServices = new JoinService(invitationServices)
  return { authServices, invitationServices, joinServices }
}
