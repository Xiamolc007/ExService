import type { AuthService, SessionIdentity } from './service.js'
import type { ProfileService } from '../profile/service.js'

declare module 'fastify' {
  interface FastifyInstance {
    authServices: AuthService
    profileServices: ProfileService
  }

  interface FastifyRequest {
    authSession: SessionIdentity | undefined
  }
}
