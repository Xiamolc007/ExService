import type { ProfileService } from './service.js'

declare module 'fastify' {
  interface FastifyInstance {
    profileServices: ProfileService
  }
}
