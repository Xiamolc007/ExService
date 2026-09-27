import type { FastifyReply, FastifyRequest } from 'fastify'
import { getJoinProofs } from '../join/transport.js'
const noStore = (reply: FastifyReply) => { void reply.header('Cache-Control', 'no-store') }
const applicant = (request: FastifyRequest, reply: FastifyReply) => { noStore(reply); request.server.invitationServices.limit(request.ip) }
const id = (request: FastifyRequest) => (request.params as { applicationId: string }).applicationId
export async function submitJoinApplication(request: FastifyRequest, reply: FastifyReply) {
  noStore(reply)
  const proofs = getJoinProofs(request)
  const value = request.server.joinServices.submit((request.body as { application: unknown }).application, proofs)
  void reply.code(202)
  return value
}
export async function queryJoinApplicationResult(request: FastifyRequest, reply: FastifyReply) {
  noStore(reply)
  return request.server.joinServices.query(request.body as { email: string })
}
export async function downloadJoinApplicationAttachment(request: FastifyRequest, reply: FastifyReply) {
  noStore(reply)
  const { applicationId, attachmentId } = request.params as { applicationId: string; attachmentId: string }
  const result = request.server.joinServices.download(applicationId, attachmentId)
  const ascii = result.originalName.replace(/[^A-Za-z0-9._ -]/g, '_') || 'attachment'
  const encoded = encodeURIComponent(result.originalName).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  void reply.header('Content-Type', 'application/octet-stream')
    .header('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`)
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Length', String(result.byteLength))
  return result.bytes
}
export async function listJoinApplications(request: FastifyRequest, reply: FastifyReply) { noStore(reply); return request.server.joinServices.list(request.query as { view?: string; limit?: string; offset?: string }) }
export async function getJoinApplication(request: FastifyRequest, reply: FastifyReply) { noStore(reply); return request.server.joinServices.get(id(request)) }
export async function approveJoinApplication(request: FastifyRequest, reply: FastifyReply) { noStore(reply); return request.server.joinServices.approve(id(request)) }
export async function rejectJoinApplication(request: FastifyRequest, reply: FastifyReply) { noStore(reply); return request.server.joinServices.reject(id(request)) }
export async function resendJoinInvitation(request: FastifyRequest, reply: FastifyReply) { noStore(reply); return request.server.joinServices.resend(id(request)) }
export async function checkInvitationEligibility(request: FastifyRequest, reply: FastifyReply) { applicant(request, reply); return request.server.invitationServices.checkEligibility((request.body as { email: string }).email) }
export async function requestInvitationCode(request: FastifyRequest, reply: FastifyReply) { applicant(request, reply); void reply.code(202); return request.server.invitationServices.requestCode((request.body as { email: string }).email) }
export async function verifyInvitationCode(request: FastifyRequest, reply: FastifyReply) { applicant(request, reply); const { email, code } = request.body as { email: string; code: string }; return request.server.invitationServices.verifyCode(email, code) }
export async function completeInvitationRegistration(request: FastifyRequest, reply: FastifyReply) { applicant(request, reply); return request.server.invitationServices.complete(request.body as { completionToken: string; nickname: string; password: string }) }
