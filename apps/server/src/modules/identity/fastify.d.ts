import type { OidcService } from './oidc.js'

declare module 'fastify' {
  interface FastifyInstance {
    oidcServices: OidcService | undefined
  }
}
