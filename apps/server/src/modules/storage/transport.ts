import type { IncomingMessage } from 'node:http'
import type { Readable, Transform } from 'node:stream'
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from 'fastify'
import { authenticateBearer } from '@server/src/auth/bearer.js'
import { MultipartWireCounter, multipartBoundary, type MultipartWireErrors } from '@server/src/http/multipart-counter.js'
import { StorageError, storageBusy } from '@server/src/modules/storage/errors.js'
import { assertStorageKey } from '@server/src/modules/storage/key.js'
import { FALLBACK_CONTENT_TYPE, assertContentType, resolveContentType, resolveMedium } from '@server/src/modules/storage/service.js'

interface UploadLimits {
  wireOverheadBytes: number; fieldBytes: number; fields: number; files: number
  fieldNameBytes: number; headerPairs: number; headerBytes: number; slots: number; deadlineMs: number
}
interface DownloadLimits { deadlineMs: number }

interface UploadContext {
  key?: string
  bytes?: Uint8Array
  medium?: string
  contentType?: string
  source?: Readable
  counter?: MultipartWireCounter
  file?: Readable
  failure?: StorageError
  parsing?: boolean
  release: () => void
}

const uploads = new WeakMap<FastifyRequest, UploadContext>()

/**
 * 由解析器生成、写入 schema body 的 data 占位标识。
 * handler 必须核对可信解析上下文，伪造的 JSON 占位不能绕过真实解析。
 */
export const STORAGE_DATA_MARKER = 'storage-content'

export interface ParsedStorageUpload {
  key: string
  bytes: Uint8Array
  medium?: string
  contentType?: string
}

const STORAGE_WIRE_ERRORS: MultipartWireErrors = {
  tooLarge: () => new StorageError('STORAGE_TOO_LARGE'),
  malformed: () => new StorageError('STORAGE_INVALID_INPUT'),
  unsupportedMediaType: () => new StorageError('STORAGE_UNSUPPORTED_MEDIA_TYPE'),
}

function config<T extends object>(value: unknown, keys: readonly string[]): T {
  if (value === null || typeof value !== 'object') throw new Error('Missing storage transport limits in API contract.')
  const limits = value as Record<string, unknown>
  for (const key of keys) {
    if (typeof limits[key] !== 'number' || !Number.isSafeInteger(limits[key]) || (limits[key] as number) < 1) {
      throw new Error(`Invalid storage transport limit: ${key}`)
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

/** 文本字段：重复、未知、截断都明确失败。 */
function readTextField(part: { value: unknown; fieldname: string; valueTruncated: boolean; fieldnameTruncated: boolean }, limits: UploadLimits): string {
  if (part.fieldnameTruncated || part.valueTruncated) throw new StorageError('STORAGE_TOO_LARGE')
  if (typeof part.value !== 'string' || Buffer.byteLength(part.value, 'utf8') > limits.fieldBytes) {
    throw new StorageError('STORAGE_INVALID_INPUT')
  }
  return part.value
}

async function parseUpload(request: FastifyRequest, limits: UploadLimits, maxBytes: number): Promise<void> {
  const context = uploads.get(request)
  if (context === undefined || context.counter === undefined) throw new StorageError('STORAGE_INVALID_INPUT')
  if (context.failure !== undefined) throw context.failure
  context.parsing = true
  const raw = request.raw
  const counter = context.counter
  // multipart 10 uses raw directly, rather than Fastify's preParsing payload.
  // Adapt only while consuming parts; retain the original connection for all lifecycle events.
  Object.assign(counter, { headers: raw.headers })
  request.raw = counter as unknown as IncomingMessage

  let key: string | undefined, medium: string | undefined, contentType: string | undefined
  let data: Uint8Array | undefined, dataMediaType: string | undefined, textParts = 0
  try {
    for await (const part of request.parts({ preservePath: true, limits: {
      parts: limits.fields + limits.files + 1,
      // busboy 的 files 限制会把第二个文件报成 413；这里让它多放行一个，
      // 由下面的显式检查把「多文件」归到结构错误 400。总 part 数仍受 parts 上限约束。
      files: limits.files + 1,
      fields: limits.fields,
      fieldSize: limits.fieldBytes,
      fileSize: maxBytes,
      fieldNameSize: limits.fieldNameBytes,
      headerPairs: limits.headerPairs,
      headerSize: limits.headerBytes,
    } })) {
      if (context.failure !== undefined) throw context.failure
      if (Buffer.byteLength(part.fieldname) > limits.fieldNameBytes) throw new StorageError('STORAGE_TOO_LARGE')

      if (part.type !== 'file') {
        if (++textParts > limits.fields) throw new StorageError('STORAGE_INVALID_INPUT')
        const value = readTextField(part, limits)
        if (part.fieldname === 'key') {
          if (key !== undefined) throw new StorageError('STORAGE_INVALID_INPUT')
          key = value
        } else if (part.fieldname === 'medium') {
          if (medium !== undefined) throw new StorageError('STORAGE_INVALID_INPUT')
          medium = value
        } else if (part.fieldname === 'contentType') {
          if (contentType !== undefined) throw new StorageError('STORAGE_INVALID_INPUT')
          contentType = value
        } else {
          throw new StorageError('STORAGE_INVALID_INPUT')
        }
        continue
      }

      if (part.fieldname !== 'data' || data !== undefined) throw new StorageError('STORAGE_INVALID_INPUT')
      const chunks: Buffer[] = []
      let bytes = 0
      context.file = part.file
      for await (const chunk of part.file) {
        bytes += chunk.length
        if (bytes > maxBytes) throw new StorageError('STORAGE_TOO_LARGE')
        chunks.push(chunk)
      }
      context.file = undefined
      // 截断标记同样视为超限：绝不保存部分文件。
      if (part.file.truncated) throw new StorageError('STORAGE_TOO_LARGE')
      data = new Uint8Array(Buffer.concat(chunks, bytes))
      dataMediaType = part.mimetype
    }

    if (key === undefined || data === undefined) throw new StorageError('STORAGE_INVALID_INPUT')
    const validatedKey = assertStorageKey(key)
    if (medium !== undefined) resolveMedium(medium, 'file')
    // 显式 contentType 优先，其次 part MIME，最后回退。
    const resolvedType = resolveContentType(contentType, dataMediaType)

    context.key = validatedKey
    // 只在解析成功后挂上字节：失败路径不保留任何内容。
    context.bytes = data
    context.medium = medium
    context.contentType = resolvedType
    request.body = {
      key: validatedKey,
      data: STORAGE_DATA_MARKER,
      ...(medium === undefined ? {} : { medium }),
      ...(resolvedType === FALLBACK_CONTENT_TYPE ? {} : { contentType: resolvedType }),
    }
  } catch (error) {
    destroyUpload(context)
    if (context.failure !== undefined) throw context.failure
    if (error instanceof StorageError) throw error
    if (typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 413) {
      throw new StorageError('STORAGE_TOO_LARGE')
    }
    throw new StorageError('STORAGE_INVALID_INPUT')
  } finally {
    request.raw = raw
  }
}

/** handler 侧读取：必须同时核对占位标识与可信解析上下文。 */
export function getStorageUpload(request: FastifyRequest): ParsedStorageUpload {
  const body = request.body as { data?: unknown } | undefined
  const context = uploads.get(request)
  if (body?.data !== STORAGE_DATA_MARKER) throw new StorageError('STORAGE_INVALID_INPUT')
  if (context === undefined) throw new StorageError('STORAGE_INVALID_INPUT')
  if (context.failure !== undefined) throw context.failure
  if (context.key === undefined || context.bytes === undefined) throw new StorageError('STORAGE_INVALID_INPUT')
  return { key: context.key, bytes: context.bytes, medium: context.medium, contentType: context.contentType }
}

/**
 * 在 Fastify 的 schema 校验之前跑模块自己的校验，
 * 让非法 key / 字段 / 票据统一产出 STORAGE_INVALID_INPUT，而不是 schema 生成的通用错误。
 */
function validateJsonBody(request: FastifyRequest, fields: readonly string[], known: readonly string[]): void {
  const body: unknown = request.body
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new StorageError('STORAGE_INVALID_INPUT')
  }
  const value = body as Record<string, unknown>
  // 未知字段在这里拒绝，与 multipart 路径一致；落到 schema 校验会变成通用 BAD_REQUEST。
  const allowed = new Set(known)
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new StorageError('STORAGE_INVALID_INPUT')
  }
  if ('key' in value) assertStorageKey(value.key)
  if ('contentType' in value && typeof value.contentType === 'string') assertContentType(value.contentType)
  if ('medium' in value && value.medium !== undefined) resolveMedium(value.medium as string, 'file')
  if ('size' in value) {
    const size = value.size
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
      throw new StorageError('STORAGE_INVALID_INPUT')
    }
  }
  if ('uploadTicket' in value) {
    const ticket = value.uploadTicket
    if (typeof ticket !== 'string' || ticket.length === 0 || ticket.length > 4096) {
      throw new StorageError('STORAGE_INVALID_INPUT')
    }
  }
  for (const field of fields) {
    if (!(field in value)) throw new StorageError('STORAGE_INVALID_INPUT')
  }
}

export interface RegisterStorageTransportOptions {
  /** 运行时配置的文件字节上限，用于 wire 上限与解析期截断。 */
  maxBytes: number
}

export function registerStorageTransport(app: FastifyInstance, options: RegisterStorageTransportOptions): void {
  let activeUploads = 0

  app.addHook('onRoute', route => {
    const operationId = (route.schema as { operationId?: string } | undefined)?.operationId

    if (operationId === 'prepareStorageUpload' || operationId === 'completeStorageUpload') {
      const fields = operationId === 'prepareStorageUpload'
        ? ['key', 'size', 'contentType'] as const
        : ['key', 'uploadTicket'] as const
      // prepare 另有可选字段 medium；其余字段一律拒绝。
      const known = operationId === 'prepareStorageUpload'
        ? ['key', 'size', 'contentType', 'medium'] as const
        : fields
      appendHook(route, 'preValidation', async (request: FastifyRequest, reply: FastifyReply) => {
        void reply.header('Cache-Control', 'no-store')
        validateJsonBody(request, fields, known)
      })
      return
    }

    if (operationId === 'getStoredFile') {
      const limits = config<DownloadLimits>((route.config as { storageDownload?: unknown }).storageDownload, ['deadlineMs'])
      // HEAD 未在 Contract 声明，关闭隐式 HEAD，避免新增未登记入口。
      route.exposeHeadRoute = false
      const timers = new WeakMap<FastifyRequest, NodeJS.Timeout>()
      appendHook(route, 'preValidation', async (request: FastifyRequest, reply: FastifyReply) => {
        void reply.header('Cache-Control', 'no-store')
        assertStorageKey((request.query as { key?: unknown }).key)
      })
      appendHook(route, 'onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
        const timer = setTimeout(() => {
          // `reply.sent` 在 Fastify 5 里等于 `raw.writableEnded`：流传输中它是 false，
          // 此时再 `reply.send()` 会抛 ERR_HTTP_HEADERS_SENT（未捕获的 rejection 会终止进程）。
          // 只有响应头还没发出时才能改写成 408 envelope。
          if (!reply.raw.headersSent) void reply.send(new StorageError('STORAGE_TIMEOUT'))
          // 头已发出后只能终止连接，不能二次写入 JSON。
          else reply.raw.destroy()
        }, limits.deadlineMs)
        timer.unref()
        timers.set(request, timer)
      })
      appendHook(route, 'onResponse', async request => { const timer = timers.get(request); if (timer !== undefined) { clearTimeout(timer); timers.delete(request) } })
      appendHook(route, 'onError', async request => { const timer = timers.get(request); if (timer !== undefined) { clearTimeout(timer); timers.delete(request) } })
      return
    }

    if (operationId !== 'uploadStorageContent') return

    const limits = config<UploadLimits>((route.config as { storageUpload?: unknown }).storageUpload,
      ['wireOverheadBytes', 'fieldBytes', 'fields', 'files', 'fieldNameBytes', 'headerPairs', 'headerBytes', 'slots', 'deadlineMs'])
    // wire 上限 = 文件上限 + 限定的 multipart 元数据开销；加法必须保持安全整数。
    const wireBytes = options.maxBytes + limits.wireOverheadBytes
    if (!Number.isSafeInteger(wireBytes)) throw new Error('Storage upload wire budget is not a safe integer.')
    route.bodyLimit = wireBytes

    appendHook(route, 'onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      void reply.header('Cache-Control', 'no-store')
      // 认证前移：任何请求体内容被消费之前完成 Bearer 校验。
      await authenticateBearer(request, request.server.authServices)
      const boundary = multipartBoundary(request.headers['content-type'], STORAGE_WIRE_ERRORS)
      if (activeUploads >= limits.slots) throw storageBusy()
      const length = request.headers['content-length']
      if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > wireBytes)) {
        throw new StorageError('STORAGE_TOO_LARGE')
      }
      activeUploads++
      let released = false
      const original = request.raw
      const context: UploadContext = { release: () => {
        if (released) return
        released = true; clearTimeout(timer); activeUploads--
        context.bytes = undefined
        original.removeListener('aborted', abort); reply.raw.removeListener('close', close)
      } }
      const abort = () => { destroyUpload(context); context.release() }
      const close = () => { destroyUpload(context); context.release() }
      const timer = setTimeout(() => {
        context.failure = new StorageError('STORAGE_TIMEOUT')
        // Reject any pending multipart iterator before releasing its buffers.
        context.counter?.destroy(context.failure)
        context.file?.destroy(context.failure)
        if (!reply.raw.headersSent) void reply.send(context.failure)
        // 头已发出后只能终止连接，不能二次写入 JSON。
        else reply.raw.destroy()
        context.release()
      }, limits.deadlineMs)
      timer.unref()
      original.once('aborted', abort); reply.raw.once('close', close)
      uploads.set(request, context)
      // wire 上限在注册时由运行时 maxBytes 加开销算出，不写死在 Contract 里。
      context.counter = new MultipartWireCounter(boundary, {
        wireBytes,
        headerBytes: limits.headerBytes,
        headerPairs: limits.headerPairs,
      }, STORAGE_WIRE_ERRORS)
      context.counter.on('error', error => {
        context.failure ??= error instanceof StorageError ? error : new StorageError('STORAGE_INVALID_INPUT')
        if (!context.parsing && !reply.raw.headersSent) void reply.send(context.failure)
      })
    })
    appendHook(route, 'preParsing', async (request: FastifyRequest, _reply: FastifyReply, payload: Readable) => {
      const context = uploads.get(request)!
      context.source = payload
      payload.on('error', error => context.counter?.destroy(error))
      payload.pipe(context.counter!)
      return context.counter! as unknown as Transform
    })
    appendHook(route, 'preValidation', async (request: FastifyRequest) => parseUpload(request, limits, options.maxBytes))
    appendHook(route, 'onResponse', async (request: FastifyRequest) => { uploads.get(request)?.release(); uploads.delete(request) })
    appendHook(route, 'onError', async (request: FastifyRequest, reply: FastifyReply) => {
      const context = uploads.get(request)
      if (context !== undefined) { destroyUpload(context); context.release() }
      // Do not keep accepting the rest of an invalid body on a persistent socket.
      void reply.header('Connection', 'close')
    })
    appendHook(route, 'onRequestAbort', async (request: FastifyRequest) => {
      const context = uploads.get(request)
      if (context !== undefined) { destroyUpload(context); context.release() }
    })
  })
}
