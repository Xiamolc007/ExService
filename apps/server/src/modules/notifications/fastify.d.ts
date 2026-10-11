import type { NotificationModule } from './factory.js'

declare module 'fastify' {
  interface FastifyInstance {
    notifications: NotificationModule
  }
}
