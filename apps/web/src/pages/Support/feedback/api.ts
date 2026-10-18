import { api, unwrapEnvelope } from '../../../api/client'
import type { components } from '@workspace/api-client'
import type { FeedbackPort } from './flow'

type Snapshot = components['schemas']['FeedbackSnapshot']
type Options = components['schemas']['FeedbackOptions']

/**
 * 后端（webman）统一响应 {msg, data}; 端点输出已采用契约 camelCase 字段,
 * 剥信封即为契约形状。
 */
export const feedbackPort: FeedbackPort = {
  prepare: async body => unwrapEnvelope<Snapshot>(await api.POST('/support/feedback/submissions', { body, alert: false, timeout: 15000 })),
  get: async submissionId => unwrapEnvelope<Snapshot>(await api.GET('/support/feedback/submissions/{submissionId}', { params: { path: { submissionId } }, alert: false, timeout: 15000 })),
  lookup: async submissionKey => unwrapEnvelope<Snapshot>(await api.GET('/support/feedback/submissions/lookup', { params: { query: { submissionKey } }, alert: false, timeout: 15000 })),
  upload: async (submissionId, attachmentId, file) => {
    const body = new FormData(); body.append('file', file, file.name)
    return unwrapEnvelope<Snapshot>(await api.PUT('/support/feedback/submissions/{submissionId}/attachments/{attachmentId}', { params: { path: { submissionId, attachmentId } }, body, alert: false, timeout: 130000 }))
  },
  advance: async (submissionId, body) => unwrapEnvelope<Snapshot>(await api.POST('/support/feedback/submissions/{submissionId}/advance', { params: { path: { submissionId } }, body, alert: false, timeout: 95000 })),
}
export const getFeedbackOptions = async (area: 'development' | 'community' = 'development') =>
  unwrapEnvelope<Options>(await api.GET('/support/feedback/options', { params: { query: { area } }, alert: false, timeout: 15000 }))
