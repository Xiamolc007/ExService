import { createServer as httpServer, request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it } from 'vitest'
import { createServer, loadConfigFromFile } from 'vite'
import { createDevEntryServer, docsProxy, isInternalPath, proxyBoundaryPlugin, trustedProxy } from '../../apps/web/dev-entry'

const cleanup: (() => Promise<void>)[] = []
it('resolves local HMR at its public entry while preserving legacy and standalone static behavior', async () => {
  const keys = ['WEBSITE_INTEGRATION_ENABLED', 'WEBSITE_INTEGRATION_MODE', 'SERVER_PUBLIC_WEB_BASE_URL', 'OUTLINE_DEV_HTTP_PORT',
    'INTEGRATION_OUTLINE_VITE_PORT', 'INTEGRATION_WEB_PORT', 'WEBSITE_DEV_ENTRY_PORT']
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  try {
    for (const [mode, integrated] of [['local', true], ['dev', true], ['', false]] as const) {
      Object.assign(process.env, { WEBSITE_INTEGRATION_ENABLED: String(integrated), WEBSITE_INTEGRATION_MODE: mode,
        SERVER_PUBLIC_WEB_BASE_URL: 'http://127.0.0.1:18080', OUTLINE_DEV_HTTP_PORT: '13102', INTEGRATION_OUTLINE_VITE_PORT: '13101', INTEGRATION_WEB_PORT: '18081' })
      delete process.env.WEBSITE_DEV_ENTRY_PORT
      const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, 'apps/web/vite.config.ts')
      const server = loaded!.config.server!
      expect(server.host).toBe(integrated && mode !== 'local' ? '0.0.0.0' : '127.0.0.1')
      expect(server.hmr).toEqual(integrated ? { protocol: 'ws', host: mode === 'local' ? '127.0.0.1' : 'exwebsite.test', clientPort: mode === 'local' ? 18080 : 8090 } : undefined)
      const proxy = server.proxy!['^/docs/static/'] as { target: string; rewrite?: (path: string) => string }
      expect(proxy.target).toBe(`${mode === 'local' ? 'http' : 'https'}://127.0.0.1:13101`)
      expect(proxy.rewrite?.('/docs/static/@vite/client') ?? '/docs/static/@vite/client').toBe(integrated ? '/docs/static/@vite/client' : '/static/@vite/client')
    }
  } finally { for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key] } }
})
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
it('keeps Website login and Docs OIDC on the configured origin before serving either entry', async () => {
  const publicOrigin = 'http://127.0.0.1:8080'
  const vite = await createServer({ configFile: false, logLevel: 'silent', server: {
    host: '127.0.0.1', port: 0, allowedHosts: true,
  }, plugins: [proxyBoundaryPlugin(publicOrigin), { name: 'website-fixture', configureServer(server) {
    return () => { server.middlewares.use((_req, res) => { res.end('Website home') }) }
  } }] })
  await vite.listen(); cleanup.push(() => vite.close())
  const entry = await createDevEntryServer(vite, 0)
  cleanup.push(() => new Promise(resolve => { entry.closeAllConnections(); entry.close(() => resolve()) }))
  for (const port of [(entry.address() as AddressInfo).port, (vite.httpServer!.address() as AddressInfo).port]) {
    for (const host of ['localhost:8080', '127.0.0.1:8081']) {
      for (const path of ['/', '/login', '/docs/?q=hello%20world', '/identity/status', '/docs?x=1', '//outside.test/path']) {
        const response = await raw(port, path, false, { Host: host })
        expect(response, `${host}${path}`).toMatchObject({ status: 307, headers: { location: `${publicOrigin}${path}` } })
        expect(response.body).not.toContain('Website home')
      }
      expect((await raw(port, '/api/auth/login', false, { Host: host }, 'POST')).status).toBe(421)
      expect((await raw(port, '/docs/internal/revoke', false, { Host: host })).status).toBe(404)
    }
    const canonical = await raw(port, '/', false, { Host: '127.0.0.1:8080' })
    expect(canonical).toMatchObject({ status: 200, body: 'Website home' })
    expect((await raw(port, '/docs?x=1', false, { Host: '127.0.0.1:8080' })).headers.location).toBe('/docs/?x=1')
  }
})
function raw(port: number, path: string, upgrade = false, headers: Record<string, string> = {}, method = 'GET') {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method,
      headers: { ...headers, ...(upgrade ? { Connection: 'Upgrade', Upgrade: 'websocket' } : {}) } })
    req.on('response', response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', value => { body += value })
      response.once('end', () => resolve({ status: response.statusCode!, headers: response.headers, body }))
    })
    req.once('upgrade', (response, socket) => { socket.destroy(); resolve({ status: response.statusCode!, headers: response.headers, body: '' }) })
    req.once('error', reject); req.setTimeout(5000, () => req.destroy(new Error('Fixture request timeout'))); req.end()
  })
}
it('blocks internal HTTP and WS bypasses on both entries before any upstream call and preserves CSRF Origin', async () => {
  const upstreamCalls: string[] = [], publicOrigin = 'http://127.0.0.1:8080'
  const upstream = httpServer((req, res) => {
    upstreamCalls.push(req.url!)
    if (req.method === 'POST' && req.headers.origin !== publicOrigin) { res.writeHead(403); res.end('CSRF_ORIGIN_REJECTED'); return }
    if (req.url?.startsWith('/redirect/')) {
      const location = decodeURIComponent(req.url.slice('/redirect/'.length))
      res.writeHead(302, { Location: location, 'Set-Cookie': ['__Host-csrfToken=value; Path=/; Secure', 'exdocs_access=value; Path=/docs; HttpOnly'] }); res.end(); return
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ path: req.url, origin: req.headers.origin, forwardedHost: req.headers['x-forwarded-host'],
      forwardedProto: req.headers['x-forwarded-proto'], docsOrigin: req.headers['x-website-docs-origin'] }))
  })
  upstream.on('upgrade', (req, socket) => {
    upstreamCalls.push(req.url!)
    socket.end(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nX-Upstream-Path: ${req.url}\r\nX-Forwarded-Host: ${req.headers['x-forwarded-host']}\r\n\r\n`)
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise(resolve => { upstream.closeAllConnections(); upstream.close(() => resolve()) }))
  const target = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
  const vite = await createServer({ configFile: false, logLevel: 'silent', server: {
    host: '127.0.0.1', port: 0, allowedHosts: true,
    proxy: { '/api': trustedProxy({ target, ws: true }, publicOrigin),
      '^/docs/static/': trustedProxy({ target, ws: true }, publicOrigin),
      '^/docs(?:/|\\?|$)': docsProxy(target, { integrated: true, publicOrigin }) },
  }, plugins: [proxyBoundaryPlugin()] })
  await vite.listen(); cleanup.push(() => vite.close())
  const entry = await createDevEntryServer(vite, 0)
  cleanup.push(() => new Promise(resolve => { entry.closeAllConnections(); entry.close(() => resolve()) }))
  const forbidden = ['/api/internal', '/api/internal/', '/api/internal?x=1', '/docs/internal/revoke', '/docs/internal?x=1',
    '/api/%69nternal/revoke', '/docs/%2569nternal/revoke', '/api/internal%2frevoke', '/docs/internal%255Crevoke',
    '/docs/static/../internal/revoke', '/docs/static/%252e%252e/internal/revoke', '/foo/../api/internal',
    '//docs//internal//revoke', '/docs\\internal\\revoke', '/%64ocs/internal', '/docs/internal%25252frevoke',
    '/docs/../api/internal', '/docs/internal%3frevoke', '/docs/%2e/internal', '/docs/%zz/internal']
  for (const port of [(entry.address() as AddressInfo).port, (vite.httpServer!.address() as AddressInfo).port]) {
    for (const path of forbidden) for (const upgrade of [false, true]) {
      const before = upstreamCalls.length
      const response = await raw(port, path, upgrade)
      expect(response.status, `${path} upgrade=${upgrade}`).toBe(404)
      expect(upstreamCalls.length).toBe(before)
    }
    expect(await raw(port, '/docs?x=1')).toMatchObject({ status: 308, headers: { location: '/docs/?x=1' } })
    const staticResponse = await raw(port, '/docs/static/@vite/client?x=1')
    expect(JSON.parse(staticResponse.body).path).toBe('/docs/static/@vite/client?x=1')
    const trusted = await raw(port, '/docs/api/documents.info', false, { Host: 'attacker.test', 'X-Forwarded-Host': 'attacker.test',
      'X-Forwarded-Proto': 'https', 'X-Website-Docs-Origin': 'http://attacker.test', Origin: publicOrigin })
    expect(JSON.parse(trusted.body)).toMatchObject({ path: '/api/documents.info', forwardedHost: '127.0.0.1:8080', forwardedProto: 'http', docsOrigin: publicOrigin })
    expect((await raw(port, '/docs/api/documents.update', false, { Origin: 'http://attacker.test' }, 'POST')).status).toBe(403)
    expect((await raw(port, '/docs/api/documents.update', false, {}, 'POST')).status).toBe(403)
    expect((await raw(port, '/docs/api/documents.update', false, { Origin: publicOrigin }, 'POST')).status).toBe(200)
    const upgrade = await raw(port, '/docs/realtime/?EIO=4&transport=websocket', true, { 'X-Forwarded-Host': 'attacker.test' })
    expect(upgrade).toMatchObject({ status: 101, headers: { 'x-upstream-path': '/realtime/?EIO=4&transport=websocket', 'x-forwarded-host': '127.0.0.1:8080' } })
    for (const location of ['/identity/login?x=1', 'http://hydra.test/oauth2/auth?x=1', '//external.test/path', '/docs/doc/already']) {
      const response = await raw(port, `/docs/redirect/${encodeURIComponent(location)}`)
      expect(response.headers.location).toBe(location)
      expect(response.headers['set-cookie']).toEqual(['__Host-csrfToken=value; Path=/; Secure', 'exdocs_access=value; Path=/docs; HttpOnly'])
    }
    expect((await raw(port, `/docs/redirect/${encodeURIComponent('/doc/example?x=1')}`)).headers.location).toBe('/docs/doc/example?x=1')
  }
})
it('normalizes deep repeated encodings, slash/backslash and dot-segment internal paths', () => {
  expect(isInternalPath('/docs/%2525252569nternal/revoke')).toBe(true)
  expect(isInternalPath('/docs/static/file.js')).toBe(false)
  expect(isInternalPath('/api/internal-other')).toBe(false)
})
