import type { ApiRequest, ApiTransportRequest, ApiJsonResult } from '@server/src/http/handler-types.js'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { getJoinProofs, type JoinTransportBody } from '@server/src/domains/join/api/transport.js'
const noStore = (reply: FastifyReply) => { void reply.header('Cache-Control', 'no-store') }
const applicant = (request: FastifyRequest, reply: FastifyReply) => { noStore(reply); request.server.invitationServices.limit(request.ip) }
const id = (request: { params: { applicationId: string } }) => request.params.applicationId
export async function submitJoinApplication(request: ApiTransportRequest<'submitJoinApplication', JoinTransportBody>, reply: FastifyReply): Promise<ApiJsonResult<'submitJoinApplication'>> {
  noStore(reply)
  const proofs = getJoinProofs(request)
  const value = await request.server.joinServices.submit(request.body.application, proofs)
  void reply.code(202)
  return value
}
export async function queryJoinApplicationResult(request: ApiRequest<'queryJoinApplicationResult'>, reply: FastifyReply): Promise<ApiJsonResult<'queryJoinApplicationResult'>> {
  noStore(reply)
  return request.server.joinServices.query(request.body)
}
export async function downloadJoinApplicationAttachment(request: ApiRequest<'downloadJoinApplicationAttachment'>, reply: FastifyReply): Promise<Buffer> {
  noStore(reply)
  const { applicationId, attachmentId } = request.params
  const result = await request.server.joinServices.download(applicationId, attachmentId)
  const ascii = result.originalName.replace(/[^A-Za-z0-9._ -]/g, '_') || 'attachment'
  const encoded = encodeURIComponent(result.originalName).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  void reply.header('Content-Type', 'application/octet-stream')
    .header('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`)
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Length', String(result.byteLength))
  return result.bytes
}
export async function listJoinApplications(request: ApiRequest<'listJoinApplications'>, reply: FastifyReply): Promise<ApiJsonResult<'listJoinApplications'>> { noStore(reply); return request.server.joinServices.list(request.query) }
export async function getJoinApplication(request: ApiRequest<'getJoinApplication'>, reply: FastifyReply): Promise<ApiJsonResult<'getJoinApplication'>> { noStore(reply); return request.server.joinServices.get(id(request)) }
export async function approveJoinApplication(request: ApiRequest<'approveJoinApplication'>, reply: FastifyReply): Promise<ApiJsonResult<'approveJoinApplication'>> { noStore(reply); return request.server.joinServices.approve(id(request)) }
export async function rejectJoinApplication(request: ApiRequest<'rejectJoinApplication'>, reply: FastifyReply): Promise<ApiJsonResult<'rejectJoinApplication'>> { noStore(reply); return request.server.joinServices.reject(id(request)) }
export async function resendJoinInvitation(request: ApiRequest<'resendJoinInvitation'>, reply: FastifyReply): Promise<ApiJsonResult<'resendJoinInvitation'>> { noStore(reply); return request.server.joinServices.resend(id(request)) }
export async function checkInvitationEligibility(request: ApiRequest<'checkInvitationEligibility'>, reply: FastifyReply): Promise<ApiJsonResult<'checkInvitationEligibility'>> { applicant(request, reply); return request.server.invitationServices.checkEligibility(request.body.email) }
export async function requestInvitationCode(request: ApiRequest<'requestInvitationCode'>, reply: FastifyReply): Promise<ApiJsonResult<'requestInvitationCode'>> { applicant(request, reply); void reply.code(202); return request.server.invitationServices.requestCode(request.body.email) }
export async function verifyInvitationCode(request: ApiRequest<'verifyInvitationCode'>, reply: FastifyReply): Promise<ApiJsonResult<'verifyInvitationCode'>> { applicant(request, reply); const { email, code } = request.body; return request.server.invitationServices.verifyCode(email, code) }
export async function completeInvitationRegistration(request: ApiRequest<'completeInvitationRegistration'>, reply: FastifyReply): Promise<ApiJsonResult<'completeInvitationRegistration'>> { applicant(request, reply); return request.server.invitationServices.complete(request.body) }
