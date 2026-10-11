import type { components } from '@workspace/api-client/types'
import type { IncomingMessage } from 'node:http'
import type { Readable, Transform } from 'node:stream'
import type { FastifyInstance, FastifyRequest, FastifyReply, RouteOptions } from 'fastify'
import { AuthError } from '@server/src/modules/auth/errors.js'
import { MultipartWireCounter, multipartBoundary, type MultipartWireErrors } from '@server/src/http/shared/multipart-counter.js'
import { normalizeJoinApplicationPayload } from '@server/src/domains/join/applications/form-validation.js'
import type { JoinProofInput } from '@server/src/domains/join/applications/attachment-validation.js'

/** Schema body after wire parsing; binary proofs live in the trusted parser context. */
export type JoinTransportBody = components['schemas']['JoinApplicationRequest']
export interface ParsedJoinUpload { application: components['schemas']['JoinApplicationPayload']; proofs: JoinProofInput[] }

interface UploadLimits {
  wireBytes: number; jsonBytes: number; fileBytes: number; totalFileBytes: number
  proofs: number; parts: number; fieldNameBytes: number; headerPairs: number
  headerBytes: number; slots: number; deadlineMs: number
}

/** 受控 wire 计数器按 join 的错误分类抛错：413 超限、415 非 multipart、400 结构非法。 */
const JOIN_WIRE_ERRORS: MultipartWireErrors = {
  tooLarge: () => new AuthError('JOIN_UPLOAD_TOO_LARGE'),
  malformed: () => new AuthError('BAD_REQUEST'),
  unsupportedMediaType: () => new AuthError('JOIN_UNSUPPORTED_MEDIA_TYPE'),
}
interface DownloadLimits { slots: number; deadlineMs: number }
interface UploadContext {
  proofs: JoinProofInput[]; source?: Readable; counter?: Transform; file?: Readable
  failure?: AuthError; parsing?: boolean; release: () => void
}
const uploads = new WeakMap<FastifyRequest, UploadContext>()

/** Buffers never enter the JSON schema body. Nonempty markers require the trusted parser context. */
export function getJoinProofs(request: FastifyRequest): JoinProofInput[] {
  const context = uploads.get(request)
  const proofs = (request.body as { proofs?: unknown } | undefined)?.proofs
  if (!Array.isArray(proofs) || proofs.some(value => typeof value !== 'string')) throw new AuthError('BAD_REQUEST')
  if (context === undefined) {
    if (proofs.length !== 0) throw new AuthError('BAD_REQUEST')
    return []
  }
  if (context.failure !== undefined) throw context.failure
  if (proofs.length !== context.proofs.length || proofs.some((value, i) => value !== `join-proof-${i}`)) throw new AuthError('BAD_REQUEST')
  return context.proofs
}

function config<T extends object>(value: unknown, keys: readonly string[]): T {
  if (value === null || typeof value !== 'object') throw new Error('Missing join transport limits in API contract.')
  const limits = value as Record<string, unknown>
  for (const key of keys) {
    if (typeof limits[key] !== 'number' || !Number.isSafeInteger(limits[key]) || (limits[key] as number) < 1) {
      throw new Error(`Invalid join transport limit: ${key}`)
    }
  }
  return value as T
}

function appendHook<K extends 'onRequest' | 'preParsing' | 'preValidation' | 'onResponse' | 'onError' | 'onRequestAbort'>(route: RouteOptions, key: K, hook: NonNullable<RouteOptions[K]>): void {
  const previous = route[key]
  // Each stage keeps existing Glue/consumer hooks in their declared order.
  Object.assign(route, { [key]: [...(previous === undefined ? [] : Array.isArray(previous) ? previous : [previous]), hook] })
}

function destroyUpload(context: UploadContext): void {
  context.source?.unpipe(context.counter)
  context.file?.destroy()
  context.counter?.destroy()
  // Stop consuming input; close the rejected connection after sending its safe response.
  context.source?.pause()
}

async function parseUpload(request: FastifyRequest, limits: UploadLimits): Promise<void> {
  const context = uploads.get(request)
  if (context === undefined || context.counter === undefined) throw new AuthError('BAD_REQUEST')
  if (context.failure !== undefined) throw context.failure
  context.parsing = true
  const raw = request.raw
  const counter = context.counter
  // multipart 10 uses raw directly, rather than Fastify's preParsing payload.
  // Adapt only while consuming parts; retain the original connection for all lifecycle events.
  Object.assign(counter, { headers: raw.headers })
  request.raw = counter as unknown as IncomingMessage
  let application: unknown, seenApplication = false, total = 0, count = 0
  try {
    for await (const part of request.parts({ preservePath: true, limits: {
      parts: limits.parts, files: limits.parts, fields: limits.parts, fieldSize: limits.jsonBytes, fileSize: Math.max(limits.fileBytes, limits.jsonBytes),
      fieldNameSize: limits.fieldNameBytes, headerPairs: limits.headerPairs, headerSize: limits.headerBytes,
    } })) {
      if (context.failure !== undefined) throw context.failure
      if (Buffer.byteLength(part.fieldname) > limits.fieldNameBytes) throw new AuthError('JOIN_UPLOAD_TOO_LARGE')
      if (part.type !== 'file') throw new AuthError('BAD_REQUEST')
      if (part.fieldname !== 'application' && part.fieldname !== 'proofs') throw new AuthError('BAD_REQUEST')
      const json = part.fieldname === 'application'
      if (json && (seenApplication || part.mimetype !== 'application/json')) throw new AuthError(seenApplication ? 'BAD_REQUEST' : 'JOIN_UNSUPPORTED_MEDIA_TYPE')
      if (json) seenApplication = true
      if (!json && ++count > limits.proofs) throw new AuthError('JOIN_UPLOAD_TOO_LARGE')
      const maxBytes = json ? limits.jsonBytes : limits.fileBytes
      const chunks: Buffer[] = []
      let bytes = 0
      context.file = part.file
      for await (const chunk of part.file) {
        bytes += chunk.length
        if (bytes > maxBytes) throw new AuthError('JOIN_UPLOAD_TOO_LARGE')
        if (!json) { total += chunk.length; if (total > limits.totalFileBytes) throw new AuthError('JOIN_UPLOAD_TOO_LARGE') }
        chunks.push(chunk)
      }
      context.file = undefined
      if (part.file.truncated) throw new AuthError('JOIN_UPLOAD_TOO_LARGE')
      const buffer = Buffer.concat(chunks, bytes)
      if (json) {
        try { application = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)) }
        catch { throw new AuthError('BAD_REQUEST') }
      } else context.proofs.push({ originalName: part.filename, bytes: buffer })
    }
    if (!seenApplication || context.failure !== undefined) throw context.failure ?? new AuthError('BAD_REQUEST')
    request.body = { application: normalizeJoinApplicationPayload(application), proofs: context.proofs.map((_, i) => `join-proof-${i}`) }
  } catch (error) {
    destroyUpload(context)
    if (context.failure !== undefined) throw context.failure
    if (error instanceof AuthError) throw error
    if (typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 413) throw new AuthError('JOIN_UPLOAD_TOO_LARGE')
    throw new AuthError('BAD_REQUEST')
  } finally { request.raw = raw }
}

export function registerJoinTransport(app: FastifyInstance): void {
  let activeUploads = 0, activeDownloads = 0
  app.addHook('onRoute', route => {
    const operationId = (route.schema as { operationId?: string } | undefined)?.operationId
    if (operationId === 'submitJoinApplication') {
      const limits = config<UploadLimits>((route.config as { joinUpload?: unknown }).joinUpload,
        ['wireBytes','jsonBytes','fileBytes','totalFileBytes','proofs','parts','fieldNameBytes','headerPairs','headerBytes','slots','deadlineMs'])
      if (limits.parts !== limits.proofs + 1 || limits.totalFileBytes > limits.proofs * limits.fileBytes || limits.jsonBytes > limits.wireBytes) throw new Error('Inconsistent join upload limits.')
      route.bodyLimit = limits.wireBytes
      appendHook(route, 'onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
        void reply.header('Cache-Control', 'no-store')
        request.server.invitationServices.limit(request.ip)
        const boundary = multipartBoundary(request.headers['content-type'], JOIN_WIRE_ERRORS)
        if (activeUploads >= limits.slots) throw new AuthError('JOIN_UPLOAD_BUSY', { retryAfterSeconds: 5 })
        const length = request.headers['content-length']
        if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > limits.wireBytes)) throw new AuthError('JOIN_UPLOAD_TOO_LARGE')
        activeUploads++
        let released = false
        const original = request.raw
        const context: UploadContext = { proofs: [], release: () => {
          if (released) return
          released = true; clearTimeout(timer); activeUploads--; context.proofs.length = 0
          original.removeListener('aborted', abort); reply.raw.removeListener('close', close)
        } }
        const abort = () => { destroyUpload(context); context.release() }
        const close = () => { destroyUpload(context); context.release() }
        const timer = setTimeout(() => {
          context.failure = new AuthError('JOIN_UPLOAD_TIMEOUT')
          // Reject any pending multipart iterator before releasing its buffers.
          context.counter?.destroy(context.failure)
          context.file?.destroy(context.failure)
          if (!reply.sent) void reply.send(context.failure)
          else reply.raw.destroy()
          context.release()
        }, limits.deadlineMs)
        timer.unref()
        original.once('aborted', abort); reply.raw.once('close', close)
        uploads.set(request, context)
        context.counter = new MultipartWireCounter(boundary, limits, JOIN_WIRE_ERRORS)
        context.counter.on('error', error => {
          context.failure ??= error instanceof AuthError ? error : new AuthError('BAD_REQUEST')
          if (!context.parsing && !reply.sent) void reply.send(context.failure)
        })
      })
      appendHook(route, 'preParsing', async (request: FastifyRequest, _reply: FastifyReply, payload: Readable) => {
        const context = uploads.get(request)!
        context.source = payload
        payload.on('error', error => context.counter?.destroy(error))
        payload.pipe(context.counter!)
        return context.counter!
      })
      appendHook(route, 'preValidation', async (request: FastifyRequest) => parseUpload(request, limits))
      appendHook(route, 'onResponse', async (request: FastifyRequest) => { uploads.get(request)?.release(); uploads.delete(request) })
      appendHook(route, 'onError', async (request: FastifyRequest, reply: FastifyReply) => {
        const context = uploads.get(request)
        if (context !== undefined) { destroyUpload(context); context.release() }
        // Do not keep accepting the rest of an invalid body on a persistent socket.
        void reply.header('Connection', 'close')
      })
      appendHook(route, 'onRequestAbort', async (request: FastifyRequest) => { const context = uploads.get(request); if (context) { destroyUpload(context); context.release() } })
    } else if (operationId === 'downloadJoinApplicationAttachment') {
      const limits = config<DownloadLimits>((route.config as { joinDownload?: unknown }).joinDownload, ['slots','deadlineMs'])
      const releases = new WeakMap<FastifyRequest, () => void>()
      appendHook(route, 'onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
        void reply.header('Cache-Control', 'no-store')
        if (activeDownloads >= limits.slots) throw new AuthError('JOIN_DOWNLOAD_BUSY', { retryAfterSeconds: 5 })
        activeDownloads++
        let released = false
        const release = () => { if (!released) { released = true; clearTimeout(timer); activeDownloads--; reply.raw.removeListener('close', release) } }
        const timer = setTimeout(() => { reply.raw.destroy(); release() }, limits.deadlineMs)
        timer.unref(); reply.raw.once('close', release); releases.set(request, release)
      })
      appendHook(route, 'onResponse', async (request: FastifyRequest) => { releases.get(request)?.(); releases.delete(request) })
      appendHook(route, 'onError', async (request: FastifyRequest) => { releases.get(request)?.(); releases.delete(request) })
      appendHook(route, 'onRequestAbort', async (request: FastifyRequest) => { releases.get(request)?.(); releases.delete(request) })
    } else if (operationId === 'queryJoinApplicationResult') {
      appendHook(route, 'onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
        void reply.header('Cache-Control', 'no-store'); request.server.invitationServices.limit(request.ip)
      })
    }
  })
}
