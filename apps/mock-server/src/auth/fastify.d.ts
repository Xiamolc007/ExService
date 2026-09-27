import type { AuthService, SessionIdentity } from './service.js'
import type { ProfileService } from '../profile/service.js'

import type { JoinService } from '../join/service.js'
import type { InvitationService } from '../invitations/service.js'

declare module 'fastify' {
  interface FastifyInstance {
    joinServices: JoinService
    invitationServices: InvitationService
    authServices: AuthService
    profileServices: ProfileService
  }

  interface FastifyRequest {
    authSession: SessionIdentity | undefined
  }
}
