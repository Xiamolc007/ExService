import { afterEach, expect, it } from 'vitest'
import { OidcService } from '@server/src/modules/identity/oidc'
import { parseIdentityConfig } from '@server/src/modules/identity/config'
import { createTestAuth, type TestAuth } from '@tests/helpers/auth'

const fixtures: TestAuth[] = []
afterEach(async () => { await Promise.all(fixtures.splice(0).map(fixture => fixture.close())) })

it('binds approved Hydra login and consent to one current Website browser session', async () => {
  const fixture = await createTestAuth()
  fixtures.push(fixture)
  const userId = await fixture.seedUser({ email: 'oidc@example.com', nickname: 'OIDC', password: 'valid password' })
  const login = await fixture.authServices.login({ email: 'oidc@example.com', password: 'valid password' })
  const session = await fixture.authServices.authenticateToken(login.token)
  const client = { client_id: 'ex-outline', client_name: 'Docs', redirect_uris: ['http://exwebsite.test:8090/docs/auth/oidc.callback'] }
  const admin = {
    getLogin: async () => ({ challenge: 'login-one', client, requested_scope: ['openid', 'profile', 'email'],
      request_url: 'http://identity.exwebsite.test:8090/oauth2/auth?redirect_uri=http%3A%2F%2Fexwebsite.test%3A8090%2Fdocs%2Fauth%2Foidc.callback',
      session_id: 'sid-one', skip: false, subject: '' }),
    acceptLogin: async () => ({ redirect_to: 'http://identity.exwebsite.test:8090/oauth2/auth?login_verifier=one' }),
    getConsent: async () => ({ challenge: 'consent-one', client, requested_scope: ['openid', 'profile', 'email'],
      login_challenge: 'login-one', login_session_id: 'sid-one', subject: userId,
      request_url: 'http://identity.exwebsite.test:8090/oauth2/auth?redirect_uri=http%3A%2F%2Fexwebsite.test%3A8090%2Fdocs%2Fauth%2Foidc.callback' }),
    acceptConsent: async () => ({ redirect_to: 'http://identity.exwebsite.test:8090/oauth2/auth?consent_verifier=one' }),
    getLogout: async () => ({ sid: 'sid-one', subject: userId, client }),
    acceptLogout: async () => ({ redirect_to: 'http://identity.exwebsite.test:8090/oauth2/sessions/logout?logout_verifier=one' }),
  }
  const service = new OidcService({ db: fixture.db, authServices: fixture.authServices,
    admin, flowKey: Buffer.alloc(32, 7), issuer: 'http://identity.exwebsite.test:8090/',
    clients: { 'ex-outline': { name: 'Docs', redirectUri: 'http://exwebsite.test:8090/docs/auth/oidc.callback',
      scopes: ['openid', 'profile', 'email'] } }, now: fixture.now })
  expect(await service.inspect('login', 'login-one')).toEqual({ clientName: 'Docs', scopes: ['openid', 'profile', 'email'] })
  const accepted = await service.acceptLogin('login-one', session)
  expect(accepted.redirectUrl).toContain('login_verifier=one')
  expect(await service.acceptLogin('login-one', session)).toEqual(accepted)
  const consent = await service.acceptConsent('consent-one', session)
  expect(consent.redirectUrl).toContain('consent_verifier=one')
  expect(await fixture.authServices.checkLinkedSession('ex-outline', 'sid-one', userId))
    .toMatchObject({ active: true, sessionId: session.id })
  const logout = await service.acceptLogout('logout-one', session)
  expect(logout.redirectUrl).toContain('logout_verifier=one')
  expect(await fixture.authServices.checkLinkedSession('ex-outline', 'sid-one', userId))
    .toEqual({ active: false, reason: 'revoked' })
  await expect(service.acceptLogout('logout-one', session)).rejects.toMatchObject({ code: 'SESSION_INVALID' })
})

it.each(['local', 'dev', 'full'])('uses the configured %s issuer and accepts only its approved callback and clients', async mode => {
  const fixture = await createTestAuth()
  fixtures.push(fixture)
  const userId = await fixture.seedUser({ email: 'configured@example.test', nickname: 'Configured', password: 'valid password' })
  const login = await fixture.authServices.login({ email: 'configured@example.test', password: 'valid password' })
  const session = await fixture.authServices.authenticateToken(login.token)
  const config = parseIdentityConfig({ WEBSITE_INTEGRATION_ENABLED: 'true', WEBSITE_INTEGRATION_MODE: mode,
    OUTLINE_INTEGRATION_KEY: 'a'.repeat(64), IDENTITY_DELIVERY_KEY: 'b'.repeat(64),
    IDENTITY_BOOTSTRAP_KEY: 'c'.repeat(64), IDENTITY_FLOW_KEY: 'd'.repeat(64),
    ...(mode === 'local' ? {} : { HYDRA_ADMIN_URL: 'http://127.0.0.1:14445/', OUTLINE_INTERNAL_URL: 'http://127.0.0.1:13000/' }) })
  if (!config.enabled) throw new Error('expected enabled')
  const client = { client_id: config.clientId, redirect_uris: [config.callback] }
  const requestUrl = new URL('oauth2/auth', config.issuer)
  requestUrl.searchParams.set('redirect_uri', config.callback)
  const request = { challenge: 'configured-login', client, requested_scope: ['openid', 'profile', 'email'],
    request_url: requestUrl.href, session_id: 'configured-sid', skip: false, subject: '' }
  const admin = {
    getLogin: async () => request,
    acceptLogin: async () => ({ redirect_to: new URL('oauth2/auth?login_verifier=local', config.issuer).href }),
    getConsent: async () => ({ ...request, challenge: 'configured-consent', login_challenge: 'configured-login',
      login_session_id: 'configured-sid', subject: userId }),
    acceptConsent: async () => ({ redirect_to: new URL('oauth2/auth?consent_verifier=local', config.issuer).href }),
    getLogout: async () => ({ sid: 'configured-sid', subject: userId, client }),
    acceptLogout: async () => ({ redirect_to: new URL('oauth2/sessions/logout?logout_verifier=local', config.issuer).href }),
  }
  const service = new OidcService({ db: fixture.db, authServices: fixture.authServices,
    admin, flowKey: Buffer.from(config.keys.flow, 'hex'), issuer: config.issuer, clients: config.approvedClients, now: fixture.now })
  expect(await service.inspect('login', request.challenge)).toMatchObject({ clientName: 'Docs' })
  await service.acceptLogin(request.challenge, session)
  await service.acceptConsent('configured-consent', session)
  expect(await fixture.authServices.checkLinkedSession(config.clientId, 'configured-sid', userId))
    .toMatchObject({ active: true, sessionId: session.id })
  client.client_id = mode === 'local' ? 'ex-outline' : 'ex-outline-local'
  await expect(service.inspect('login', request.challenge)).rejects.toMatchObject({ code: 'IDENTITY_CLIENT_FORBIDDEN' })
  client.client_id = config.clientId
  requestUrl.searchParams.set('redirect_uri', `${config.callback}?other=true`)
  request.request_url = requestUrl.href
  await expect(service.inspect('login', request.challenge)).rejects.toMatchObject({ code: 'IDENTITY_CLIENT_FORBIDDEN' })
  client.client_id = 'ex-oidc-probe'
  if (mode === 'local') await expect(service.inspect('login', request.challenge))
    .rejects.toMatchObject({ code: 'IDENTITY_CLIENT_FORBIDDEN' })
})
