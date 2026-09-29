import type { AuthService, SessionIdentity } from '@server/src/auth/service.js'
import type { ProfileService } from '@server/src/profile/service.js'

import type { JoinService } from '@server/src/join/service.js'
import type { InvitationService } from '@server/src/invitations/service.js'

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
