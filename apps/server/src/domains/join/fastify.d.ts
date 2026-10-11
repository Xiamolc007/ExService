import type { JoinService } from './applications/service.js'
import type { InvitationService } from './invitations/service.js'

declare module 'fastify' {
  interface FastifyInstance {
    joinServices: JoinService
    invitationServices: InvitationService
  }
}
