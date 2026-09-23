import type { AuthService, SessionIdentity } from './service.js'

declare module 'fastify' {
  interface FastifyInstance {
    authServices: AuthService
  }

  interface FastifyRequest {
    authSession: SessionIdentity | undefined
  }
}
