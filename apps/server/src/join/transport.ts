import type { IncomingMessage } from 'node:http'
import { Transform, type Readable } from 'node:stream'
import type { FastifyInstance, FastifyRequest, FastifyReply, RouteOptions } from 'fastify'
import { AuthError } from '@server/src/auth/errors.js'
import { normalizeJoinApplicationPayload } from '@server/src/join/form-validation.js'
import type { JoinProofInput } from '@server/src/join/attachment-validation.js'

interface UploadLimits {
  wireBytes: number; jsonBytes: number; fileBytes: number; totalFileBytes: number
  proofs: number; parts: number; fieldNameBytes: number; headerPairs: number
  headerBytes: number; slots: number; deadlineMs: number
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

/** Enforces header budgets before busboy, whose header parser otherwise truncates excess headers. */
class MultipartCounter extends Transform {
  receivedEncodedLength = 0
  private pending = Buffer.alloc(0)
  private phase: 'preamble' | 'headers' | 'body' | 'suffix' | 'done' = 'preamble'
  private readonly boundary: Buffer
  private readonly firstBoundary: Buffer
  constructor(boundary: string, private readonly limits: UploadLimits) {
    super()
    this.boundary = Buffer.from(`\r\n--${boundary}`)
    this.firstBoundary = Buffer.from(`--${boundary}`)
  }
  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
    try {
      this.receivedEncodedLength += chunk.length
      if (this.receivedEncodedLength > this.limits.wireBytes) throw new AuthError('JOIN_UPLOAD_TOO_LARGE')
      this.scan(chunk)
      callback(null, chunk)
    } catch (error) { callback(error as Error) }
  }
  private scan(chunk: Buffer): void {
    this.pending = Buffer.concat([this.pending, chunk])
    for (;;) {
      if (this.phase === 'done') { this.pending = Buffer.alloc(0); return }
      if (this.phase === 'preamble') {
        const index = this.pending.indexOf(this.firstBoundary)
        if (index < 0) { this.pending = this.pending.subarray(Math.max(0, this.pending.length - this.firstBoundary.length)); return }
        this.pending = this.pending.subarray(index + this.firstBoundary.length); this.phase = 'suffix'
      } else if (this.phase === 'suffix') {
        if (this.pending.length < 2) return
        if (this.pending.subarray(0, 2).equals(Buffer.from('--'))) { this.phase = 'done'; continue }
        if (!this.pending.subarray(0, 2).equals(Buffer.from('\r\n'))) throw new AuthError('BAD_REQUEST')
        this.pending = this.pending.subarray(2); this.phase = 'headers'
      } else if (this.phase === 'headers') {
        const end = this.pending.indexOf('\r\n\r\n')
        if ((end < 0 ? this.pending.length : end + 4) > this.limits.headerBytes) throw new AuthError('JOIN_UPLOAD_TOO_LARGE')
        if (end < 0) return
        const lines = this.pending.subarray(0, end).toString('latin1').split('\r\n')
        if (lines.length > this.limits.headerPairs) throw new AuthError('JOIN_UPLOAD_TOO_LARGE')
        if (lines.some(line => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+:/.test(line))) throw new AuthError('BAD_REQUEST')
        this.pending = this.pending.subarray(end + 4); this.phase = 'body'
      } else {
        const index = this.pending.indexOf(this.boundary)
        if (index < 0) { this.pending = this.pending.subarray(Math.max(0, this.pending.length - this.boundary.length - 2)); return }
        // Only delimiter suffixes count; the same bytes can occur inside a file.
        const suffix = this.pending.subarray(index + this.boundary.length, index + this.boundary.length + 2)
        if (suffix.length < 2) { this.pending = this.pending.subarray(index); return }
        if (!suffix.equals(Buffer.from('--')) && !suffix.equals(Buffer.from('\r\n'))) {
          this.pending = this.pending.subarray(index + 2); continue
        }
        this.pending = this.pending.subarray(index + this.boundary.length); this.phase = 'suffix'
      }
    }
  }
}

function multipartBoundary(request: FastifyRequest): string {
  const contentType = request.headers['content-type']
  if (typeof contentType !== 'string' || !/^multipart\/form-data(?:\s*;|$)/i.test(contentType)) throw new AuthError('JOIN_UNSUPPORTED_MEDIA_TYPE')
  const match = /(?:^|;)\s*boundary=(?:"([^"\r\n]+)"|([^;\s]+))/i.exec(contentType)
  const boundary = match?.[1] ?? match?.[2]
  if (boundary === undefined || boundary.length > 200 || /[\r\n]/.test(boundary)) throw new AuthError('BAD_REQUEST')
  return boundary
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
        const boundary = multipartBoundary(request)
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
        context.counter = new MultipartCounter(boundary, limits)
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
