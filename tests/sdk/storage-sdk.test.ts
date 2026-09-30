import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StorageSdkError } from '@sdk/src/errors'

const putObject = vi.fn(async () => ({ statusCode: 200 }))
const constructorArgs: unknown[] = []

/**
 * 裸包名由 vitest.config.ts 的别名解析到 packages/sdk 下的同一份依赖；
 * 没有别名时从 tests/ 出发解析不到，mock 会静默失效并让 SDK 真的去连 COS。
 */
vi.mock('cos-nodejs-sdk-v5', () => ({
  default: class {
    constructor(options: unknown) { constructorArgs.push(options) }
    putObject = putObject
  },
}))

const { createSdk } = await import('@sdk/src/node')

const BASE = 'http://127.0.0.1:8080/api'
const CREDENTIALS = {
  tmpSecretId: 'tmp-id',
  tmpSecretKey: 'tmp-key',
  securityToken: 'tmp-token',
  startTime: 1_800_000_000,
  expiredTime: 1_800_001_800,
}

interface Recorded { url: string; method: string; authorization?: string; json?: unknown; fields?: Record<string, string>; fileBytes?: Uint8Array; fileType?: string; filename?: string }

const calls: Recorded[] = []
let responder: (url: string) => { status: number; body: unknown } = () => ({ status: 200, body: {} })

beforeEach(() => {
  calls.length = 0
  putObject.mockClear()
  constructorArgs.length = 0
  vi.stubGlobal('fetch', async (request: Request) => {
    const url = new URL(request.url).pathname
    const recorded: Recorded = { url, method: request.method, authorization: request.headers.get('authorization') ?? undefined }
    const type = request.headers.get('content-type') ?? ''
    if (type.startsWith('multipart/form-data')) {
      const form = await request.formData()
      recorded.fields = {}
      for (const [name, value] of form.entries()) {
        if (typeof value === 'string') recorded.fields[name] = value
        else {
          recorded.fileBytes = new Uint8Array(await value.arrayBuffer())
          recorded.fileType = value.type
          recorded.filename = value.name
        }
      }
    } else {
      recorded.json = await request.json().catch(() => undefined)
    }
    calls.push(recorded)
    const { status, body } = responder(url)
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  })
})

afterEach(() => { vi.unstubAllGlobals() })

function sdk(getAccessToken: () => string | Promise<string> = () => 'token-a') {
  return createSdk({ baseUrl: BASE, getAccessToken })
}

describe('SDK file branch', () => {
  it('prepares, uploads multipart and returns only the URL string', async () => {
    responder = url => url.endsWith('/prepare')
      ? { status: 200, body: { medium: 'file', maxBytes: 20 * 1024 * 1024 } }
      : { status: 200, body: { url: `${BASE}/storage/files?key=demo%2Fa.bin` } }

    const result = await sdk().storage.upload('demo/a.bin', new Uint8Array([1, 2, 3]), { contentType: 'image/webp' })
    expect(result).toBe(`${BASE}/storage/files?key=demo%2Fa.bin`)
    expect(calls.map(call => call.url)).toEqual(['/api/storage/uploads/prepare', '/api/storage/uploads'])

    const upload = calls[1]!
    expect(upload.fields).toMatchObject({ key: 'demo/a.bin', medium: 'file', contentType: 'image/webp' })
    expect(Array.from(upload.fileBytes!)).toEqual([1, 2, 3])
    // boundary 由 FormData 生成，不手写 Content-Type。
    expect(upload.filename).toBe('a.bin')
  })

  it('sends a freshly obtained token on every own-site request', async () => {
    let counter = 0
    responder = url => url.endsWith('/prepare')
      ? { status: 200, body: { medium: 'file', maxBytes: 1024 } }
      : { status: 200, body: { url: 'u' } }
    await sdk(async () => `token-${++counter}`).storage.upload('a.bin', new Uint8Array([1]))
    expect(calls.map(call => call.authorization)).toEqual(['Bearer token-1', 'Bearer token-2'])
  })

  it('accepts Blob input and uses its media type', async () => {
    responder = url => url.endsWith('/prepare')
      ? { status: 200, body: { medium: 'file', maxBytes: 1024 } }
      : { status: 200, body: { url: 'u' } }
    await sdk().storage.upload('a.bin', new Blob([new Uint8Array([7])], { type: 'text/plain' }))
    expect(calls[0]!.json).toMatchObject({ key: 'a.bin', size: 1, contentType: 'text/plain' })
    expect(calls[1]!.fields!.contentType).toBe('text/plain')
  })

  it('falls back to octet-stream when no media type is available', async () => {
    responder = url => url.endsWith('/prepare')
      ? { status: 200, body: { medium: 'file', maxBytes: 1024 } }
      : { status: 200, body: { url: 'u' } }
    await sdk().storage.upload('a.bin', new Uint8Array([7]))
    expect(calls[0]!.json).toMatchObject({ contentType: 'application/octet-stream' })
  })

  it('pre-checks against the server maxBytes before uploading', async () => {
    responder = () => ({ status: 200, body: { medium: 'file', maxBytes: 4 } })
    await expect(sdk().storage.upload('a.bin', new Uint8Array(5))).rejects.toMatchObject({ code: 'TOO_LARGE' })
    expect(calls).toHaveLength(1)
  })
})

describe('SDK cos branch', () => {
  const plan = {
    medium: 'cos', maxBytes: 1024, bucket: 'exre-1250000000', region: 'ap-guangzhou',
    key: 'demo/a.bin', credentials: CREDENTIALS, uploadTicket: 'ticket-value',
  }

  function cosResponder() {
    responder = url => {
      if (!url.endsWith('/prepare')) return { status: 200, body: { url: 'https://signed.example/a.bin' } }
      // 计划里的 key 取服务器回显值，用于验证 SDK 沿用服务器决定的 key。
      const requested = calls.at(-1)!.json as { key: string }
      return { status: 200, body: { ...plan, key: requested.key } }
    }
  }

  it('puts the object with STS credentials and then confirms', async () => {
    cosResponder()
    const result = await sdk().storage.upload('demo/a.bin', new Uint8Array([1, 2, 3, 4]), { contentType: 'image/webp' })
    expect(result).toBe('https://signed.example/a.bin')
    expect(calls.map(call => call.url)).toEqual(['/api/storage/uploads/prepare', '/api/storage/uploads/complete'])
    expect(calls[1]!.json).toEqual({ key: 'demo/a.bin', uploadTicket: 'ticket-value' })
  })

  it('calls PutObject explicitly with attachment, no-store and an explicit length', async () => {
    cosResponder()
    await sdk().storage.upload('demo/a.bin', new Uint8Array([1, 2, 3, 4]), { contentType: 'image/webp' })
    expect(putObject).toHaveBeenCalledTimes(1)
    expect(putObject.mock.calls[0]![0]).toMatchObject({
      Bucket: 'exre-1250000000',
      Region: 'ap-guangzhou',
      Key: 'demo/a.bin',
      ContentLength: 4,
      ContentType: 'image/webp',
      ContentDisposition: 'attachment',
      CacheControl: 'no-store',
    })
    expect(Buffer.from(putObject.mock.calls[0]![0]!.Body as Buffer)).toEqual(Buffer.from([1, 2, 3, 4]))
  })

  it('never sends the Bearer token to COS and builds one client per call', async () => {
    cosResponder()
    await sdk().storage.upload('one.bin', new Uint8Array([1]))
    await sdk().storage.upload('two.bin', new Uint8Array([2]))
    // 每次调用独立持有凭证，不使用全局可变缓存。
    expect(constructorArgs).toHaveLength(2)
    for (const args of constructorArgs) {
      expect(JSON.stringify(args)).not.toContain('Bearer')
    }
    // 每次调用使用服务器为本次 key 返回的计划，凭证实例互不共享。
    expect(putObject.mock.calls.map(call => call[0]!.Key)).toEqual(['one.bin', 'two.bin'])
    expect(constructorArgs[0]).not.toBe(constructorArgs[1])
  })

  it('pins the medium returned by prepare and does not switch to file mid-flight', async () => {
    cosResponder()
    await sdk().storage.upload('demo/a.bin', new Uint8Array([1]))
    // 客户端不能改用其他本站路径：全部请求都在 baseUrl 之下。
    expect(calls.every(call => call.url.startsWith('/api/'))).toBe(true)
    expect(calls.some(call => call.url === '/api/storage/uploads')).toBe(false)
  })

  it('does not retry when the confirm step fails', async () => {
    responder = url => url.endsWith('/prepare')
      ? { status: 200, body: plan }
      : { status: 404, body: { error: { code: 'STORAGE_NOT_FOUND', message: '对象不存在。', requestId: 'req-9' } } }
    await expect(sdk().storage.upload('demo/a.bin', new Uint8Array([1]))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(putObject).toHaveBeenCalledTimes(1)
    expect(calls.filter(call => call.url === '/api/storage/uploads/complete')).toHaveLength(1)
  })

  it('does not attempt another confirm when PutObject itself fails', async () => {
    cosResponder()
    putObject.mockRejectedValueOnce(new Error('cos network down'))
    await expect(sdk().storage.upload('demo/a.bin', new Uint8Array([1]))).rejects.toBeInstanceOf(StorageSdkError)
    expect(calls.filter(call => call.url === '/api/storage/uploads/complete')).toHaveLength(0)
  })
})

describe('SDK error mapping', () => {
  const stages = [
    { stage: 'prepare', path: '/api/storage/uploads/prepare', medium: 'file', requests: ['/api/storage/uploads/prepare'], puts: 0 },
    { stage: 'upload', path: '/api/storage/uploads', medium: 'file', requests: ['/api/storage/uploads/prepare', '/api/storage/uploads'], puts: 0 },
    { stage: 'complete', path: '/api/storage/uploads/complete', medium: 'cos', requests: ['/api/storage/uploads/prepare', '/api/storage/uploads/complete'], puts: 1 },
  ]
  const failures = [
    { failure: 'network', cause: new TypeError('fetch failed'), code: 'NETWORK' },
    { failure: 'timeout', cause: new DOMException('deadline expired', 'TimeoutError'), code: 'TIMEOUT' },
    { failure: 'abort', cause: new DOMException('request aborted', 'AbortError'), code: 'TIMEOUT' },
  ]

  it.each(stages.flatMap(stage => failures.map(failure => ({ ...stage, ...failure }))))(
    'maps $failure errors during $stage without retrying or continuing',
    async ({ path, medium, requests, puts, cause, code }) => {
      responder = url => {
        if (url === path) throw cause
        return {
          status: 200,
          body: medium === 'file'
            ? { medium: 'file', maxBytes: 1024 }
            : { medium: 'cos', maxBytes: 1024, bucket: 'exre-1250000000', region: 'ap-guangzhou',
              key: 'a.bin', credentials: CREDENTIALS, uploadTicket: 'ticket-value' },
        }
      }

      const error = await sdk().storage.upload('a.bin', new Uint8Array([1])).then(
        () => { throw new Error('expected failure') },
        (error: unknown) => error,
      )
      expect(error).toBeInstanceOf(StorageSdkError)
      expect(error).toMatchObject({ code })
      expect(calls.map(call => call.url)).toEqual(requests)
      expect(putObject).toHaveBeenCalledTimes(puts)
    },
  )

  it('maps server codes, status and requestId onto StorageSdkError', async () => {
    responder = () => ({ status: 413, body: { error: { code: 'STORAGE_TOO_LARGE', message: '内容超过允许的大小。', requestId: 'req-1' } } })
    const error = await sdk().storage.upload('a.bin', new Uint8Array([1]))
      .then(() => { throw new Error('expected failure') }, (e: unknown) => e as StorageSdkError)
    expect(error).toBeInstanceOf(StorageSdkError)
    expect(error.code).toBe('TOO_LARGE')
    expect(error.status).toBe(413)
    expect(error.requestId).toBe('req-1')
  })

  it('keeps URLs, tickets and credentials out of the error text', async () => {
    responder = () => ({
      status: 400,
      body: { error: { code: 'STORAGE_INVALID_INPUT', message: 'bad key https://bucket.cos.ap-guangzhou.myqcloud.com/a?token=tmp-token', requestId: 'req-2' } },
    })
    const error = await sdk().storage.upload('a.bin', new Uint8Array([1]))
      .then(() => { throw new Error('expected failure') }, (e: unknown) => e as StorageSdkError)
    expect(error.message).not.toContain('tmp-token')
    expect(error.message).not.toContain('https://')
    expect(error.message).toContain('[url]')
  })

  it('rejects a Node baseUrl that is not absolute', () => {
    expect(() => createSdk({ baseUrl: '/api', getAccessToken: () => 't' })).toThrow(StorageSdkError)
  })

  it('rejects an empty access token before calling the server', async () => {
    await expect(sdk(() => '').storage.upload('a.bin', new Uint8Array([1]))).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(calls).toHaveLength(0)
  })
})
