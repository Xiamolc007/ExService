import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { ensureHydraClient, verifyHydraClient } from './hydra-client.mjs'

async function fixture(run) {
  const clients = new Map()
  const secrets = new Map()
  const calls = []
  const server = createServer(async (request, response) => {
    calls.push([request.method, request.url])
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/oauth2/token') {
      const valid = [...secrets].some(([id, secret]) => request.headers.authorization === `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`)
      response.statusCode = valid ? 400 : 401
      response.end(JSON.stringify({ error: valid ? 'invalid_grant' : 'invalid_client' }))
      return
    }
    if (request.method === 'GET') {
      const client = clients.get(request.url.split('/').at(-1))
      response.statusCode = client ? 200 : 404
      response.end(JSON.stringify(client ?? {}))
      return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const client = JSON.parse(Buffer.concat(chunks).toString())
    secrets.set(client.client_id, client.client_secret)
    clients.set(client.client_id, client)
    client.authorization_code_grant_access_token_lifespan = '1m0s'
    client.authorization_code_grant_id_token_lifespan = '1m0s'
    response.statusCode = 201
    response.end(JSON.stringify(client))
    delete client.client_secret
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await run({ adminUrl: `http://127.0.0.1:${server.address().port}`, publicUrl: `http://127.0.0.1:${server.address().port}`,
      clientSecret: 'fixture-client-secret',
      calls, getClient: (id = 'ex-outline') => clients.get(id) })
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
}

test('creates the exact fixed client and accepts an identical retry without updating it', async () => {
  await fixture(async state => {
    await ensureHydraClient(state)
    await ensureHydraClient(state)
    const client = state.getClient()
    assert.equal(client.client_id, 'ex-outline')
    assert.deepEqual(client.redirect_uris, ['http://exwebsite.test:8090/docs/auth/oidc.callback'])
    assert.deepEqual(client.grant_types, ['authorization_code'])
    assert.equal(client.scope, 'openid profile email')
    assert.equal(client.token_endpoint_auth_method, 'client_secret_basic')
    assert.equal(client.authorization_code_grant_access_token_lifespan, '1m0s')
    assert.equal(state.calls.filter(([method, path]) => method === 'POST' && path === '/admin/clients').length, 1)
    assert.equal(state.calls.filter(([method]) => method === 'PUT').length, 0)
  })
})

test('registers the separate fixed probe client without changing the Outline client', async () => {
  await fixture(async state => {
    await ensureHydraClient(state)
    await ensureHydraClient({ ...state, clientId: 'ex-oidc-probe', clientSecret: 'separate-probe-secret' })
    await ensureHydraClient({ ...state, clientId: 'ex-oidc-probe', clientSecret: 'separate-probe-secret' })
    assert.equal(state.getClient('ex-oidc-probe')?.client_id, 'ex-oidc-probe')
    assert.deepEqual(state.getClient('ex-oidc-probe')?.redirect_uris, ['http://127.0.0.1:18765/callback'])
    assert.deepEqual(state.getClient('ex-oidc-probe')?.post_logout_redirect_uris, ['http://127.0.0.1:18765/signed-out'])
    assert.deepEqual(state.getClient().redirect_uris, ['http://exwebsite.test:8090/docs/auth/oidc.callback'])
    assert.notEqual(state.getClient().metadata.secretFingerprint, state.getClient('ex-oidc-probe').metadata.secretFingerprint)
    assert.equal(state.calls.filter(([method, path]) => method === 'POST' && path === '/admin/clients').length, 2)
    const before = state.calls.length
    await assert.rejects(ensureHydraClient({ ...state, clientId: 'unknown-client' }), /configuration/)
    assert.equal(state.calls.length, before)
  })
})

test('rejects changed callbacks, privileges, or secret rather than overwriting an existing client', async () => {
  for (const change of [client => { client.redirect_uris.push('http://other.test/callback') },
    client => { client.grant_types.push('refresh_token') }, client => { client.scope += ' offline_access' },
    client => { client.metadata.issuer = 'http://other.test/' },
    client => { client.metadata.secretFingerprint = 'different' }]) {
    await fixture(async state => {
      await ensureHydraClient(state)
      change(state.getClient())
      await assert.rejects(ensureHydraClient(state), /conflict/)
      assert.equal(state.calls.filter(([method, path]) => method !== 'GET' && path !== '/oauth2/token').length, 1)
    })
  }
})

test('read-only runtime verify refuses missing clients without creating or updating', async () => fixture(async state => {
  await assert.rejects(verifyHydraClient(state), /initialization failed/)
  assert.equal(state.calls.filter(([method]) => method !== 'GET').length, 0)
  await ensureHydraClient(state)
  const before = state.calls.filter(([method, path]) => method === 'POST' && path === '/admin/clients').length
  await verifyHydraClient(state)
  assert.equal(state.calls.filter(([method, path]) => method === 'POST' && path === '/admin/clients').length, before)
}))
test('local issuer client callbacks and metadata are fixed to the validated local origin', async () => fixture(async state => {
  const options = { ...state, mode: 'local', clientId: 'ex-outline-local', publicOrigin: 'http://127.0.0.1:8080' }
  await ensureHydraClient(options)
  assert.equal(state.getClient('ex-outline-local').metadata.issuer, `${state.publicUrl}/`)
  assert.deepEqual(state.getClient('ex-outline-local').redirect_uris, ['http://127.0.0.1:8080/docs/auth/oidc.callback'])
  await verifyHydraClient(options)
  await assert.rejects(ensureHydraClient({ ...options, callback: 'http://127.0.0.1:8081/wrong' }), /configuration/)
  await assert.rejects(ensureHydraClient({ ...options, publicOrigin: 'http://localhost:8080' }), /configuration/)
}))
