import type { FastifyReply, FastifyRequest } from 'fastify'
import { requireSession } from '@server/src/handlers/auth.js'
import { assertStorageKey, lastKeySegment, quotedStringFilename } from '@server/src/modules/storage/key.js'
import { getStorageUpload } from '@server/src/modules/storage/transport.js'
import type { Medium } from '@server/src/modules/storage/service.js'
import type { CompleteUploadInput, PrepareUploadInput } from '@server/src/modules/storage/direct-upload.js'

export async function prepareStorageUpload(request: FastifyRequest, reply: FastifyReply) {
  void reply.header('Cache-Control', 'no-store')
  const session = requireSession(request)
  const body = request.body as PrepareUploadInput
  return request.server.storageServices.direct.prepare(session.userId, body)
}

export async function uploadStorageContent(request: FastifyRequest, reply: FastifyReply) {
  void reply.header('Cache-Control', 'no-store')
  // 认证由 transport 的 onRequest 前移完成，Glue 的 preHandler 再复核一次。
  requireSession(request)
  // 必须走可信解析上下文：schema body 里的 data 只是占位标识。
  const parsed = getStorageUpload(request)
  const url = await request.server.storageServices.service.upload(parsed.key, parsed.bytes, {
    ...(parsed.medium === undefined ? {} : { medium: parsed.medium as Medium }),
    ...(parsed.contentType === undefined ? {} : { contentType: parsed.contentType }),
  })
  return { url }
}

export async function completeStorageUpload(request: FastifyRequest, reply: FastifyReply) {
  void reply.header('Cache-Control', 'no-store')
  const session = requireSession(request)
  const body = request.body as CompleteUploadInput
  return request.server.storageServices.direct.complete(session.userId, body)
}

/**
 * 本地介质的公开读取。
 *
 * 响应头发出前的失败返回 envelope；发出后读取失败只能终止连接，不二次写入 JSON。
 */
export async function getStoredFile(request: FastifyRequest, reply: FastifyReply) {
  void reply.header('Cache-Control', 'no-store')
  const key = assertStorageKey((request.query as { key?: unknown }).key)
  const read = await request.server.storageServices.fileAdapter.openRead(key)
  void reply.header('Content-Length', String(read.bytes))
  void reply.header('Content-Disposition', `attachment; filename=${quotedStringFilename(lastKeySegment(key))}`)
  void reply.header('X-Content-Type-Options', 'nosniff')
  void reply.type('application/octet-stream')
  // 首版不支持 Range：收到 Range 仍返回完整 200。
  reply.raw.once('close', () => { void read.release() })
  return reply.send(read.stream)
}
