import type { AuthService, SessionIdentity } from '@server/src/auth/service.js'
import type { ProfileService } from '@server/src/profile/service.js'

import type { JoinService } from '@server/src/join/service.js'
import type { InvitationService } from '@server/src/invitations/service.js'
import type { StorageServices } from '@server/src/modules/storage/factory.js'
import type { OidcService } from '@server/src/identity/oidc.js'

declare module 'fastify' {
  interface FastifyInstance {
    joinServices: JoinService
    invitationServices: InvitationService
    authServices: AuthService
    profileServices: ProfileService
    storageServices: StorageServices
    oidcServices: OidcService | undefined
  }

  interface FastifyRequest {
    authSession: SessionIdentity | undefined
    identityClientId: string | undefined
  }
}
