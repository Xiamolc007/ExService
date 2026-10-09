import type { FastifyReply, FastifyRequest } from 'fastify'
import { AuthError } from '@server/src/auth/errors.js'
import { requireSession } from '@server/src/handlers/auth.js'

function noStore(reply: FastifyReply): void { void reply.header('Cache-Control', 'no-store') }

function oidc(request: FastifyRequest) {
  const service = request.server.oidcServices
  if (!service) throw new AuthError('IDENTITY_UPSTREAM_UNAVAILABLE')
  return service
}

export async function inspectOidcRequest(request: FastifyRequest, reply: FastifyReply) {
  noStore(reply)
  const { phase, challenge } = request.body as { phase: 'login' | 'consent'; challenge: string }
  return oidc(request).inspect(phase, challenge)
}

export async function acceptOidcLogin(request: FastifyRequest, reply: FastifyReply) {
  noStore(reply)
  const { challenge } = request.body as { challenge: string }
  return oidc(request).acceptLogin(challenge, requireSession(request))
}

export async function acceptOidcConsent(request: FastifyRequest, reply: FastifyReply) {
  noStore(reply)
  const { challenge } = request.body as { challenge: string }
  return oidc(request).acceptConsent(challenge, requireSession(request))
}

export async function acceptOidcLogout(request: FastifyRequest, reply: FastifyReply) {
  noStore(reply)
  const { challenge } = request.body as { challenge: string }
  return oidc(request).acceptLogout(challenge, requireSession(request))
}

export async function checkLinkedSession(request: FastifyRequest, reply: FastifyReply) {
  noStore(reply)
  if (!request.identityClientId) throw new AuthError('IDENTITY_UNAUTHORIZED')
  const { hydraSid, subject } = request.body as { hydraSid: string; subject: string }
  return request.server.authServices.checkLinkedSession(request.identityClientId, hydraSid, subject)
}

export async function revokeLinkedSession(request: FastifyRequest, reply: FastifyReply) {
  noStore(reply)
  if (!request.identityClientId) throw new AuthError('IDENTITY_UNAUTHORIZED')
  const { hydraSid, subject, requestId } = request.body as { hydraSid: string; subject: string; requestId: string }
  return request.server.authServices.revokeLinkedSession(request.identityClientId, hydraSid, subject, requestId)
}

export async function inspectIdentityUser(request: FastifyRequest, reply: FastifyReply) {
  noStore(reply)
  const { userId } = request.body as { userId: string }
  const result = await request.server.authServices.inspectIdentityUser(userId)
  if (!result) throw new AuthError('IDENTITY_NOT_FOUND')
  return result
}
