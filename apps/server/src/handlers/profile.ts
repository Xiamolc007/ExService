import type { FastifyReply, FastifyRequest } from 'fastify'
import type { AvatarUpload, ProfileUpdate } from '@server/src/profile/service.js'
import { requireSession } from '@server/src/handlers/auth.js'

export async function updateCurrentUser(request: FastifyRequest, reply: FastifyReply) {
  void reply.header('Cache-Control', 'no-store')
  return request.server.profileServices.update(requireSession(request).userId, request.body as ProfileUpdate)
}

export async function uploadCurrentUserAvatar(request: FastifyRequest, reply: FastifyReply) {
  void reply.header('Cache-Control', 'no-store')
  const session = requireSession(request)
  return request.server.profileServices.upload(session.userId, request.body as AvatarUpload,
    tx => request.server.authServices.assertSessionCurrent(session, tx, true))
}

export async function getAvatarImage(request: FastifyRequest, reply: FastifyReply) {
  void reply.header('Cache-Control', 'no-store')
  void reply.type('image/webp')
  const { avatarId } = request.params as { avatarId: string }
  return request.server.profileServices.readAvatar(avatarId)
}
