import type { ClickUpServices } from './service.js'

declare module 'fastify' {
  interface FastifyInstance {
    clickupServices: ClickUpServices
  }
}
