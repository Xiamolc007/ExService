import { instance, storage, setBaseUrl, setAccessToken } from '@workspace/sdk'
import type { components, RequestConfig } from '@workspace/sdk'
const known: Promise<{ status: 'ok' }> = instance({ url: '/health' })
const detail: Promise<components['schemas']['NotificationDetail']> = instance({ url: '/notifications/{notificationId}', pathParams: { notificationId: 'id' } })
const listed = instance({ url: '/notifications', method: 'get', params: { view: 'unread', limit: 20 } })
const login: Promise<components['schemas']['LoginResponse']> = instance({ url: '/auth/login', method: 'POST', data: { email: 'fixture@example.test', password: 'fixture-password' } })
// @ts-expect-error JSON literal excess properties remain checked through const inference.
instance({ url: '/auth/login', method: 'POST', data: { email: 'fixture@example.test', password: 'fixture-password', invented: true } })
declare const prepared: components['schemas']['FeedbackPrepare']
instance({ url: '/support/feedback/submissions', method: 'POST', data: prepared })
declare const attachment: components['schemas']['FeedbackAttachmentDeclaration']
instance({ url: '/support/feedback/submissions', method: 'POST', data: { ...prepared, attachments: [attachment] } })
instance({ url: '/support/feedback/submissions', method: 'POST', data: { ...prepared, attachments: [{ ...attachment }] } })
const attachmentTuple: [components['schemas']['FeedbackAttachmentDeclaration'], components['schemas']['FeedbackAttachmentDeclaration']] = [attachment, attachment]
const readonlyAttachment = { ...attachment } as const
instance({ url: '/support/feedback/submissions', method: 'POST', data: { ...prepared, attachments: attachmentTuple } })
instance({ url: '/support/feedback/submissions', method: 'POST', data: { ...prepared, attachments: [readonlyAttachment] } })
// @ts-expect-error JSON array members preserve the generated additionalProperties:false boundary.
instance({ url: '/support/feedback/submissions', method: 'POST', data: { ...prepared, attachments: [{ ...attachment, unexpected: true }] } })
// @ts-expect-error Every member is checked, including later elements in an inferred tuple.
instance({ url: '/support/feedback/submissions', method: 'POST', data: { ...prepared, attachments: [attachment, { ...attachment, unexpected: true }] } })
// @ts-expect-error Required discriminated form fields cannot be replaced with an unrelated branch.
instance({ url: '/support/feedback/submissions', method: 'POST', data: { ...prepared, form: { kind: 'bug', typeOptionId: null } } })
const downloaded: Promise<Blob> = instance({ url: '/storage/files', params: { key: 'demo/file.bin' }, responseType: 'blob' })
const mode = 'text' as 'text' | 'arraybuffer'
const unionResponse: Promise<string | ArrayBuffer> = instance({ url: '/health', responseType: mode })
const config: RequestConfig = { url: '/health' }
instance(config)
instance({ url: '/storage/uploads', method: 'post', data: new FormData() })
instance({ url: '/auth/logout', method: 'POST' })
storage.upload('a.bin', new Uint8Array([1]))
setBaseUrl('http://localhost/api'); setAccessToken(null)
// @ts-expect-error Unknown operation.
instance({ url: '/missing' })
// @ts-expect-error Retired application operation remains absent from the generated contract.
instance({ url: '/join/applications', method: 'POST', data: new FormData() })
// @ts-expect-error Method/path pair comes from the contract.
instance({ url: '/auth/login', method: 'GET' })
// @ts-expect-error Omitted method only selects GET.
instance({ url: '/auth/login', data: {} })
// @ts-expect-error Login requires JSON data.
instance({ url: '/auth/login', method: 'POST' })
// @ts-expect-error Detail requires pathParams.
instance({ url: '/notifications/{notificationId}' })
// @ts-expect-error Unknown path parameter.
instance({ url: '/notifications/{notificationId}', pathParams: { notificationId: 'x', unknown: 'x' } })
// @ts-expect-error Query parameter is required.
instance({ url: '/storage/files' })
// @ts-expect-error Empty query does not supply key.
instance({ url: '/storage/files', params: {} })
// @ts-expect-error Query fields come from the contract, including through const generics.
instance({ url: '/notifications', params: { view: 'unread', invented: 'x' } })
// @ts-expect-error JSON operations reject FormData.
instance({ url: '/auth/login', method: 'POST', data: new FormData() })
// @ts-expect-error Multipart operation requires FormData.
instance({ url: '/storage/uploads', method: 'POST', data: { file: 'invalid' } })
// @ts-expect-error GET without a request body rejects data.
instance({ url: '/health', data: {} })
// @ts-expect-error No query on this operation.
instance({ url: '/health', params: {} })
// @ts-expect-error No path on this operation.
instance({ url: '/health', pathParams: {} })
// @ts-expect-error Runtime override is never a public config field.
instance({ url: '/health', adapter: 'fetch' })
// @ts-expect-error Caller cannot choose a response DTO as a type argument.
instance<{ invented: true }>({ url: '/health' })
// @ts-expect-error Blob response is not a JSON DTO.
const wrongDownload: Promise<{ status: string }> = instance({ url: '/storage/files', params: { key: 'x' }, responseType: 'blob' })
// @ts-expect-error Object API has no method family.
instance.GET('/health')
// @ts-expect-error Setters live only on the root export.
instance.setToken('token')
// @ts-expect-error No legacy factory.
import { createApiClient, createSdk, createExAxios, ExAxios } from '@workspace/sdk'
type BugIntake = Extract<components['schemas']['FeedbackPrepare']['form'], { kind: 'bug' }>
const selectedBugCategory: BugIntake['typeOptionId'] = '00000000-0000-4000-8000-000000000001'
// @ts-expect-error New Bug submissions require a classification.
const missingBugCategory: BugIntake['typeOptionId'] = null
const previousBugCategory: components['schemas']['FeedbackBugForm']['typeOptionId'] = null
void [known, detail, listed, login, downloaded, unionResponse, wrongDownload, selectedBugCategory, missingBugCategory, previousBugCategory]
