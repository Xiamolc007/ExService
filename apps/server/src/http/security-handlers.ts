import type { FastifyRequest } from 'fastify'
import { authenticateBearer } from '../modules/auth/api/security.js'
import { createIdentitySecurityHandlers } from '../modules/identity/api/security.js'
import type { IdentityApiPluginOptions } from '../modules/identity/api/plugin.js'

export function createSecurityHandlers(identityKeys: IdentityApiPluginOptions['identityKeys']) {
  return {
    async bearerAuth(request: FastifyRequest): Promise<void> {
      // Recheck after parsing uploads in case their session expired or was revoked.
      await authenticateBearer(request, request.server.authServices)
    },
    ...createIdentitySecurityHandlers(identityKeys),
  }
}
