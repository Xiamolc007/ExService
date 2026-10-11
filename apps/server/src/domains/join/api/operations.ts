import { submitJoinApplication, queryJoinApplicationResult, downloadJoinApplicationAttachment, listJoinApplications, getJoinApplication, approveJoinApplication, rejectJoinApplication, resendJoinInvitation, checkInvitationEligibility, requestInvitationCode, verifyInvitationCode, completeInvitationRegistration } from './handlers.js'

export const operations = {
  submitJoinApplication,
  queryJoinApplicationResult,
  downloadJoinApplicationAttachment,
  listJoinApplications,
  getJoinApplication,
  approveJoinApplication,
  rejectJoinApplication,
  resendJoinInvitation,
  checkInvitationEligibility,
  requestInvitationCode,
  verifyInvitationCode,
  completeInvitationRegistration,
} as const
