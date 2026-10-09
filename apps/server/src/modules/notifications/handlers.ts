import type { FastifyReply, FastifyRequest } from 'fastify'
import { requireSession } from '@server/src/handlers/auth.js'

/**
 * Contract 登记的 handler。
 *
 * 所有路径都只接受已认证会话，userId 一律取自认证上下文，不接受请求体里的身份。
 * 响应全部 no-store：通知是私人数据。
 */

interface ListQuery {
  view: 'unread' | 'history'
  scope?: string
  category?: string
  limit?: number
  cursor?: string
}

interface ClearBatchesQuery {
  limit?: number
  cursor?: string
}

interface NotificationIdParams {
  notificationId: string
}

interface BatchIdParams {
  batchId: string
}

interface StateBody {
  read: boolean
  expectedRevision: number
}

interface ReadAllBody {
  requestId: string
  readThroughToken: string
}

interface ClearAllBody {
  requestId: string
  clearSnapshotToken: string
}

interface PreferencesBody {
  expectedRevision: number
  optionalCategories: { announcement: boolean; personal_update: boolean }
}

export async function listNotifications(request: FastifyRequest, reply: FastifyReply) {
  void reply.header('Cache-Control', 'no-store')
  const query = request.query as ListQuery
  return request.server.notifications.service.list({
    userId: requireSession(request).userId,
    view: query.view,
    scope: query.scope ?? null,
    category: query.category ?? null,
    limit: query.limit ?? null,
    cursor: query.cursor ?? null,
  })
}

export async function getNotificationSummary(request: FastifyRequest, reply: FastifyReply) {
  void reply.header('Cache-Control', 'no-store')
  return request.server.notifications.service.summary(requireSession(request).userId)
}

export async function getNotification(request: FastifyRequest, reply: FastifyReply) {
  void reply.header('Cache-Control', 'no-store')
  const { notificationId } = request.params as NotificationIdParams
  return request.server.notifications.service.detail(requireSession(request).userId, notificationId)
}

export async function updateNotificationState(request: FastifyRequest, reply: FastifyReply) {
  void reply.header('Cache-Control', 'no-store')
  const { notificationId } = request.params as NotificationIdParams
  const body = request.body as StateBody
  return request.server.notifications.service.updateState(
    requireSession(request).userId, notificationId, body.read, body.expectedRevision)
}

export async function markNotificationsReadThrough(request: FastifyRequest, reply: FastifyReply) {
  void reply.header('Cache-Control', 'no-store')
  const body = request.body as ReadAllBody
  return request.server.notifications.service.readThrough(
    requireSession(request).userId, body.requestId, body.readThroughToken)
}

export async function previewNotificationClear(request: FastifyRequest, reply: FastifyReply) {
  void reply.header('Cache-Control', 'no-store')
  return request.server.notifications.service.previewClear(requireSession(request).userId)
}

export async function clearNotificationsSnapshot(request: FastifyRequest, reply: FastifyReply) {
  void reply.header('Cache-Control', 'no-store')
  const body = request.body as ClearAllBody
  return request.server.notifications.service.clearSnapshot(
    requireSession(request).userId, body.requestId, body.clearSnapshotToken)
}

export async function listNotificationClearBatches(request: FastifyRequest, reply: FastifyReply) {
  void reply.header('Cache-Control', 'no-store')
  const query = request.query as ClearBatchesQuery
  return request.server.notifications.service.listClearBatches(
    requireSession(request).userId, query.limit ?? null, query.cursor ?? null)
}

export async function restoreNotificationClearBatch(request: FastifyRequest, reply: FastifyReply) {
  void reply.header('Cache-Control', 'no-store')
  const { batchId } = request.params as BatchIdParams
  const body = request.body as { requestId: string }
  return request.server.notifications.service.restoreBatch(
    requireSession(request).userId, batchId, body.requestId)
}

export async function getNotificationPreferences(request: FastifyRequest, reply: FastifyReply) {
  void reply.header('Cache-Control', 'no-store')
  return request.server.notifications.service.getPreferences(requireSession(request).userId)
}

export async function updateNotificationPreferences(request: FastifyRequest, reply: FastifyReply) {
  void reply.header('Cache-Control', 'no-store')
  const body = request.body as PreferencesBody
  return request.server.notifications.service.updatePreferences(
    requireSession(request).userId, body.expectedRevision, body.optionalCategories)
}
