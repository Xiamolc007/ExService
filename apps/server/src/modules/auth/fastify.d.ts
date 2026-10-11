import type { AuthService } from './service.js'

declare module 'fastify' {
  interface FastifyInstance {
    authServices: AuthService
  }
}
