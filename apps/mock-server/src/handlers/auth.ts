import type { FastifyReply, FastifyRequest } from 'fastify'
import { randomBytes } from 'node:crypto'
import type { LoginInput } from '../auth/service.js'

function noStore(reply: FastifyReply): void {
  void reply.header('Cache-Control', 'no-store')
}

// Valid 1 x 1 PNG only for exercising the reserved JSON contract.
const PLACEHOLDER_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII='

export async function createCaptchaChallenge(_request: FastifyRequest, reply: FastifyReply) {
  noStore(reply)
  return {
    challengeId: randomBytes(32).toString('base64url'),
    imageBase64: PLACEHOLDER_PNG,
    expiresAt: Date.now() + 5 * 60 * 1000,
  }
}

export async function login(request: FastifyRequest, reply: FastifyReply) {
  noStore(reply)
  return request.server.authServices.login(request.body as LoginInput)
}

export async function getCurrentUser(request: FastifyRequest, reply: FastifyReply) {
  noStore(reply)
  return request.server.profileServices.snapshot(requireSession(request).userId)
}

export async function logout(request: FastifyRequest, reply: FastifyReply) {
  noStore(reply)
  return request.server.authServices.logout(requireSession(request))
}

export async function inspectSsoRequest(request: FastifyRequest, reply: FastifyReply) {
  noStore(reply)
  const { ssoRequestId } = request.body as { ssoRequestId: string }
  return request.server.authServices.inspectSsoRequest(ssoRequestId)
}

export async function loginForSso(request: FastifyRequest, reply: FastifyReply) {
  noStore(reply)
  return request.server.authServices.loginForSso(request.body as LoginInput & { ssoRequestId: string })
}

export async function confirmSsoWithSession(request: FastifyRequest, reply: FastifyReply) {
  noStore(reply)
  const { ssoRequestId } = request.body as { ssoRequestId: string }
  return request.server.authServices.confirmSsoWithSession(ssoRequestId, requireSession(request))
}

export function requireSession(request: FastifyRequest) {
  if (request.authSession === undefined) {
    throw new Error('security handler did not attach an authenticated session')
  }
  return request.authSession
}
