import type { StorageServices } from './factory.js'

declare module 'fastify' {
  interface FastifyInstance {
    storageServices: StorageServices
  }
}
