import { request as httpRequest, type ClientRequest } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import { createApp } from '@workspace/mock-server'
import { createTestAuth, newJoinApplication, experiencedJoinApplication } from '@tests/helpers/auth'
import { joinMultipart } from '@tests/helpers/multipart'

const fixtures: ReturnType<typeof createTestAuth>[] = [], apps: ReturnType<typeof createApp>[] = []
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); fixtures.splice(0).forEach(f => f.close()) })
async function setup(uploadOverrides: Record<string, number> = {}, downloadOverrides: Record<string, number> = {}, configure?: (app: ReturnType<typeof createApp>) => void) {
  const f = createTestAuth(); fixtures.push(f)
  const app = createApp({ ...f }); apps.push(app)
  app.addHook('onRoute', route => {
    const config = (route.config ?? {}) as { joinUpload?: Record<string, number>; joinDownload?: Record<string, number> }
    if (config.joinUpload) Object.assign(config.joinUpload, uploadOverrides)
    if (config.joinDownload) Object.assign(config.joinDownload, downloadOverrides)
  })
  let observed = 0
  const observers: Array<{ count: number; resolve: () => void }> = []
  app.addHook('preValidation', async request => {
    if (request.url === '/api/join/applications') {
      observed++; observers.filter(waiter => waiter.count <= observed).forEach(waiter => waiter.resolve())
    }
  })
  const entered = (count: number) => observed >= count ? Promise.resolve() : new Promise<void>(resolve => observers.push({ count, resolve }))
  configure?.(app)
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address()
  if (address === null || typeof address === 'string') throw new Error('No socket address')
  return { f, app, port: address.port, entered }
}
function client(port: number, path = '/api/join/applications', method = 'POST', headers: Record<string, string> = { 'content-type': 'multipart/form-data; boundary=hold-boundary' }) {
  let req: ClientRequest
  const result = new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
    req = httpRequest({ host: '127.0.0.1', port, path, method, headers, agent: false }, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString() }))
      res.on('error', reject)
    })
    req.on('error', reject)
  })
  // Deliberate disconnect tests must not create an unhandled rejected Promise.
  void result.catch(() => {})
  return { req: req!, result }
}
function hold(port: number) {
  const connection = client(port)
  connection.req.write('--hold-boundary\r\nContent-Disposition: form-data; name="application"; filename="application.json"\r\nContent-Type: application/json\r\n\r\n{')
  return connection
}
async function submit(port: number, email: string) {
  const body = joinMultipart(newJoinApplication(email))
  const connection = client(port, undefined, undefined, body.headers)
  connection.req.end(body.payload)
  return connection.result
}
const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve))

it('rejects the third live upload before body, keeps downloads independent, and releases aborted slots', async () => {
  const { f, app, port, entered } = await setup()
  f.joinServices.submit(experiencedJoinApplication(), [{ originalName: 'proof.txt', bytes: Buffer.from('evidence') }])
  const detail = f.joinServices.get(f.joinServices.list({}).items[0]!.id)
  const first = hold(port), second = hold(port)
  await entered(2)
  const rejected = client(port); rejected.req.flushHeaders()
  const busy = await rejected.result
  expect(busy.status).toBe(503); expect(JSON.parse(busy.body).error.code).toBe('JOIN_UPLOAD_BUSY'); expect(busy.headers['retry-after']).toBe('5')
  const download = await app.inject({ method: 'GET', url: `/api/admin/join/applications/${detail.application.id}/attachments/${detail.attachments[0]!.id}` })
  expect(download.statusCode).toBe(200)
  first.req.destroy(); await first.result.catch(() => {}); await nextTurn()
  const retry = await submit(port, 'after-abort@example.com')
  expect(retry.status, retry.body).toBe(202)
  second.req.destroy(); await second.result.catch(() => {})
  expect(f.sqlite.prepare('SELECT count(*) n FROM join_applications').get()).toEqual({ n: 2 })
}, 10000)

it('cancels stalled uploads with 408 and permits a real retry after both timeouts', async () => {
  const { port, entered } = await setup({ deadlineMs: 150 })
  const first = hold(port), second = hold(port)
  await entered(2)
  for (const response of await Promise.all([first.result, second.result])) {
    expect(response.status).toBe(408); expect(JSON.parse(response.body).error.code).toBe('JOIN_UPLOAD_TIMEOUT')
    expect(response.headers['cache-control']).toBe('no-store')
  }
  const retried = await submit(port, 'timeout-retry@example.com')
  expect(retried.status, retried.body).toBe(202)
}, 10000)

it('counts chunked wire bytes without Content-Length, reports truncated streams and restores raw lifecycle', async () => {
  const { port, f } = await setup({ wireBytes: 65536 })
  const large = client(port)
  large.req.write(Buffer.alloc(65537, 65)); large.req.end()
  const response = await large.result
  expect(response.status).toBe(413); expect(JSON.parse(response.body).error.code).toBe('JOIN_UPLOAD_TOO_LARGE')
  const truncated = client(port)
  truncated.req.end('--hold-boundary\r\nContent-Disposition: form-data; name="application"; filename="application.json"\r\nContent-Type: application/json\r\n\r\n{"email":"x@example.com"}')
  expect((await truncated.result).status).toBe(400)
  const accepted = await submit(port, 'wire-retry@example.com')
  expect(accepted.status, accepted.body).toBe(202)
  expect(f.sqlite.prepare('SELECT count(*) n FROM join_applications').get()).toEqual({ n: 1 })
}, 10000)

it('holds only two binary response slots, releases disconnected/timed-out downloads and allows later reads', async () => {
  let path = ''
  let sends = 0, release: (() => void) | undefined
  const pending = new Promise<void>(resolve => { release = resolve })
  const waiting: Array<() => void> = []
  let unblock = false
  const { f, port } = await setup({}, { deadlineMs: 250 }, app => app.addHook('onSend', async (request, reply, payload) => {
    if (request.url === path && reply.statusCode === 200 && !unblock) {
      sends++; waiting.splice(0).forEach(resolve => resolve()); await pending
    }
    return payload
  }))
  f.joinServices.submit(experiencedJoinApplication(), [{ originalName: 'proof.txt', bytes: Buffer.from('evidence') }])
  const detail = f.joinServices.get(f.joinServices.list({}).items[0]!.id)
  path = `/api/admin/join/applications/${detail.application.id}/attachments/${detail.attachments[0]!.id}`
  const first = client(port, path, 'GET', {}), second = client(port, path, 'GET', {})
  first.req.end(); second.req.end()
  const ready = (count: number) => sends >= count ? Promise.resolve() : new Promise<void>(resolve => waiting.push(() => { if (sends >= count) resolve(); else waiting.push(resolve) }))
  await ready(2)
  const third = client(port, path, 'GET', {}); third.req.end()
  const busy = await third.result
  expect(busy.status).toBe(503); expect(JSON.parse(busy.body).error.code).toBe('JOIN_DOWNLOAD_BUSY')
  first.req.destroy(); await first.result.catch(() => {})
  await second.result.catch(() => {})
  unblock = true; release!()
  const retry = client(port, path, 'GET', {}); retry.req.end()
  expect((await retry.result).status).toBe(200)
}, 10000)
