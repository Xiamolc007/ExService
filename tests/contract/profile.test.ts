import { readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, serviceHandlers } from '@workspace/mock-server'
import { ProfileService, publicAvatarBaseUrl } from '../../apps/mock-server/src/profile/service'
import { createTestAuth } from '../helpers/auth'

const sharp = createRequire(new URL('../../apps/mock-server/package.json', import.meta.url))('sharp')

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWMwTptpnDaTAUIBAB/uBMm6iK1UAAAAAElFTkSuQmCC'
const fixtures: Array<ReturnType<typeof createTestAuth>> = []
const apps: Array<ReturnType<typeof createApp>> = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  fixtures.splice(0).forEach((fixture) => fixture.close())
})

function setup(createUserId?: () => string) {
  const fixture = createTestAuth(createUserId ? { createUserId } : {})
  fixtures.push(fixture)
  const app = createApp({ authServices: fixture.authServices, profileServices: fixture.profileServices })
  apps.push(app)
  return { fixture, app }
}

async function session(fixture: ReturnType<typeof createTestAuth>) {
  const started = await fixture.authServices.startRegistration({
    email: 'profile@example.com', nickname: 'First', password: 'valid password',
  })
  fixture.authServices.verifyRegistration(started.registrationId, '123456')
  const { token } = await fixture.authServices.login({ email: 'profile@example.com', password: 'valid password' })
  return `Bearer ${token}`
}

describe('profile contract operations', () => {
  it.each([[1024, 512], [512, 1024], [64, 64]])(
    'normalizes a %i by %i direct upload to 512 square WebP', async (width, height) => {
      const { fixture, app } = setup()
      const authorization = await session(fixture)
      const source = await sharp({ create: { width, height, channels: 3, background: '#367cad' } })
        .png().toBuffer()
      const uploaded = await app.inject({ method: 'POST', url: '/api/auth/me/avatar',
        headers: { authorization }, payload: { mediaType: 'image/png', imageBase64: source.toString('base64') } })
      expect(uploaded.statusCode).toBe(200)
      const avatarUrl = (uploaded.json() as { avatarUrl: string }).avatarUrl
      const image = await app.inject({ method: 'GET', url: new URL(avatarUrl).pathname })
      expect(image.statusCode).toBe(200)
      expect(await sharp(image.rawPayload).metadata()).toMatchObject({
        width: 512, height: 512, format: 'webp',
      })
    },
  )

  it('uses an explicit public avatar address behind a proxy', async () => {
    const { fixture } = setup()
    const authorization = await session(fixture)
    const identity = fixture.authServices.authenticateToken(authorization.slice(7))
    const base = publicAvatarBaseUrl('https://example.test/site/api/avatars')
    const service = new ProfileService(fixture.sqlite, fixture.avatarDirectory, base)
    const snapshot = await service.upload(identity.userId,
      { mediaType: 'image/png', imageBase64: PNG },
      () => fixture.authServices.assertSessionCurrent(identity))
    expect(snapshot.avatarUrl).toMatch(/^https:\/\/example\.test\/site\/api\/avatars\//)
    expect(() => publicAvatarBaseUrl('javascript:alert(1)')).toThrow()
  })

  it('requires a session and applies only submitted text fields', async () => {
    const { fixture, app } = setup()
    const anonymous = await app.inject({ method: 'PATCH', url: '/api/auth/me', payload: { nickname: 'No' } })
    expect(anonymous.statusCode).toBe(401)
    expect(anonymous.json()).toMatchObject({ error: { code: 'SESSION_INVALID' } })
    const authorization = await session(fixture)

    const changed = await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: { authorization }, payload: {
      nickname: ' Updated ', qq: '000123', fivemId: 'fivem:42',
    } })
    expect(changed.statusCode).toBe(200)
    expect(changed.headers['cache-control']).toBe('no-store')
    expect(changed.json()).toEqual({
      id: '10000000-0000-4000-8000-000000000001', email: 'profile@example.com',
      nickname: 'Updated', qq: '000123', fivemId: 'fivem:42', avatarUrl: null,
    })
    const cleared = await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: { authorization }, payload: {
      qq: null,
    } })
    expect(cleared.json()).toMatchObject({ nickname: 'Updated', qq: null, fivemId: 'fivem:42' })
    expect(fixture.sqlite.prepare('SELECT nickname, qq, fivem_id FROM auth_users').get()).toEqual({
      nickname: 'Updated', qq: null, fivem_id: 'fivem:42',
    })
    expect((await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: { authorization }, payload: {} })).json())
      .toEqual(cleared.json())

    for (const payload of [{ email: 'other@example.com' }, { id: 'another-user' }, { group: 'admin' },
      { qq: '' }, { fivemId: '42' }, { nickname: '' }]) {
      const rejected = await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: { authorization }, payload })
      expect(rejected.statusCode).toBe(400)
    }
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization } })
    expect(me.json()).toEqual(cleared.json())

    const identity = fixture.authServices.authenticateToken(authorization.slice(7))
    const raw = await serviceHandlers.updateCurrentUser({
      body: { qq: '007' }, authSession: identity,
      server: { profileServices: fixture.profileServices },
    } as Parameters<typeof serviceHandlers.updateCurrentUser>[0], rawReply())
    expect(Object.keys(raw)).toEqual(['id', 'email', 'nickname', 'qq', 'fivemId', 'avatarUrl'])
    expect(raw.qq).toBe('007')
  })

  it('cannot read or change another account through the profile operations', async () => {
    let nextId = 1
    const { fixture, app } = setup(() => `10000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`)
    const firstAuthorization = await session(fixture)
    const second = await fixture.authServices.startRegistration({
      email: 'second@example.com', nickname: 'Second', password: 'valid password',
    })
    fixture.authServices.verifyRegistration(second.registrationId, '123456')
    const { token: secondToken } = await fixture.authServices.login({
      email: 'second@example.com', password: 'valid password',
    })
    const secondAuthorization = `Bearer ${secondToken}`
    const changed = await app.inject({ method: 'PATCH', url: '/api/auth/me',
      headers: { authorization: firstAuthorization }, payload: { qq: '0009' } })
    expect(changed.statusCode).toBe(200)
    const secondMe = await app.inject({ method: 'GET', url: '/api/auth/me',
      headers: { authorization: secondAuthorization } })
    expect(secondMe.json()).toMatchObject({ email: 'second@example.com', qq: null })
    const forged = await app.inject({ method: 'PATCH', url: '/api/auth/me',
      headers: { authorization: firstAuthorization }, payload: { id: secondMe.json().id, qq: '42' } })
    expect(forged.statusCode).toBe(400)
    expect(fixture.sqlite.prepare('SELECT qq FROM auth_users WHERE email = ?').get('second@example.com'))
      .toEqual({ qq: null })
  })

  it('uploads a WebP avatar, serves only current references, then clears it', async () => {
    const { fixture, app } = setup()
    const authorization = await session(fixture)
    const payload = { mediaType: 'image/png', imageBase64: PNG }
    const first = await app.inject({ method: 'POST', url: '/api/auth/me/avatar', headers: { authorization }, payload })
    expect(first.statusCode).toBe(200)
    const firstUrl = (first.json() as { avatarUrl: string }).avatarUrl
    expect(firstUrl).toMatch(/^http:\/\/127\.0\.0\.1:8080\/api\/avatars\/[A-Za-z0-9_-]{43}$/)
    const firstImage = await app.inject({ method: 'GET', url: new URL(firstUrl).pathname })
    expect(firstImage.statusCode).toBe(200)
    expect(firstImage.headers['content-type']).toMatch(/^image\/webp/)
    expect(firstImage.headers['cache-control']).toBe('no-store')
    expect(firstImage.rawPayload.subarray(0, 4).toString()).toBe('RIFF')

    const second = await app.inject({ method: 'POST', url: '/api/auth/me/avatar', headers: { authorization }, payload })
    expect(second.statusCode).toBe(200)
    const secondUrl = (second.json() as { avatarUrl: string }).avatarUrl
    expect(secondUrl).not.toBe(firstUrl)
    expect((await app.inject({ method: 'GET', url: new URL(firstUrl).pathname })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: new URL(secondUrl).pathname })).statusCode).toBe(200)
    expect(readdirSync(fixture.avatarDirectory)).toHaveLength(1)

    const cleared = await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: { authorization }, payload: { avatar: null } })
    expect(cleared.statusCode).toBe(200)
    expect(cleared.json()).toMatchObject({ avatarUrl: null })
    expect((await app.inject({ method: 'GET', url: new URL(secondUrl).pathname })).statusCode).toBe(404)
    expect(readdirSync(fixture.avatarDirectory)).toHaveLength(0)

    const identity = fixture.authServices.authenticateToken(authorization.slice(7))
    const raw = await serviceHandlers.uploadCurrentUserAvatar({
      body: payload, authSession: identity, server: {
        profileServices: fixture.profileServices, authServices: fixture.authServices,
      },
    } as Parameters<typeof serviceHandlers.uploadCurrentUserAvatar>[0], rawReply())
    expect(Object.keys(raw)).toEqual(['id', 'email', 'nickname', 'qq', 'fivemId', 'avatarUrl'])
    expect(raw.avatarUrl).toMatch(/^http:\/\/127\.0\.0\.1:8080\/api\/avatars\//)
    const avatarId = raw.avatarUrl!.split('/').at(-1)!
    const rawImage = await serviceHandlers.getAvatarImage({
      params: { avatarId }, server: { profileServices: fixture.profileServices },
    } as Parameters<typeof serviceHandlers.getAvatarImage>[0], rawReply())
    expect(Buffer.isBuffer(rawImage)).toBe(true)
    expect(rawImage.subarray(0, 4).toString()).toBe('RIFF')
  })

  it('rejects malformed, disguised, and oversized images without changing the profile', async () => {
    const { fixture, app } = setup()
    const authorization = await session(fixture)
    for (const payload of [
      { mediaType: 'image/png', imageBase64: 'not base64' },
      { mediaType: 'image/jpeg', imageBase64: PNG },
      { mediaType: 'image/svg+xml', imageBase64: PNG },
    ]) {
      const response = await app.inject({ method: 'POST', url: '/api/auth/me/avatar', headers: { authorization }, payload })
      expect(response.statusCode).toBe(400)
    }
    const oversized = await app.inject({ method: 'POST', url: '/api/auth/me/avatar', headers: { authorization }, payload: {
      mediaType: 'image/png', imageBase64: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64'),
    } })
    expect(oversized.statusCode).toBe(413)
    expect(oversized.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } })
    expect(fixture.sqlite.prepare('SELECT avatar_key FROM auth_users').get()).toEqual({ avatar_key: null })
    expect(readdirSync(fixture.avatarDirectory)).toHaveLength(0)
  })

  it('rejects a revoked session at the avatar write and removes its new file', async () => {
    const { fixture } = setup()
    const authorization = await session(fixture)
    const identity = fixture.authServices.authenticateToken(authorization.slice(7))
    await expect(fixture.profileServices.upload(identity.userId,
      { mediaType: 'image/png', imageBase64: PNG }, () => {
        fixture.authServices.logout(identity)
        fixture.authServices.assertSessionCurrent(identity)
      })).rejects.toMatchObject({ code: 'SESSION_INVALID' })
    expect(fixture.sqlite.prepare('SELECT avatar_key FROM auth_users').get()).toEqual({ avatar_key: null })
    expect(readdirSync(fixture.avatarDirectory)).toHaveLength(0)
  })

  it('removes a newly written file if the database update fails and returns 404 for a missing file', async () => {
    const { fixture, app } = setup()
    const authorization = await session(fixture)
    fixture.sqlite.exec(`CREATE TRIGGER fail_avatar_update BEFORE UPDATE OF avatar_key ON auth_users
      BEGIN SELECT RAISE(ABORT, 'secret database failure'); END`)
    const failed = await app.inject({ method: 'POST', url: '/api/auth/me/avatar', headers: { authorization }, payload: {
      mediaType: 'image/png', imageBase64: PNG,
    } })
    expect(failed.statusCode).toBe(500)
    expect(failed.body).not.toContain('secret database failure')
    expect(readdirSync(fixture.avatarDirectory)).toHaveLength(0)
    fixture.sqlite.exec('DROP TRIGGER fail_avatar_update')
    const successful = await app.inject({ method: 'POST', url: '/api/auth/me/avatar', headers: { authorization }, payload: {
      mediaType: 'image/png', imageBase64: PNG,
    } })
    expect(successful.statusCode).toBe(200)
    const url = (successful.json() as { avatarUrl: string }).avatarUrl
    unlinkSync(`${fixture.avatarDirectory}/${url.split('/').at(-1)}.webp`)
    expect((await app.inject({ method: 'GET', url: new URL(url).pathname })).statusCode).toBe(404)
  })

  it('uses the safe error envelope when the avatar directory is not writable', async () => {
    const { fixture } = setup()
    const authorization = await session(fixture)
    const blockedPath = `${fixture.avatarDirectory}/blocked`
    writeFileSync(blockedPath, 'not a directory')
    const profileServices = new ProfileService(fixture.sqlite, blockedPath)
    const app = createApp({ authServices: fixture.authServices, profileServices })
    apps.push(app)
    const response = await app.inject({ method: 'POST', url: '/api/auth/me/avatar',
      headers: { authorization }, payload: { mediaType: 'image/png', imageBase64: PNG } })
    expect(response.statusCode).toBe(500)
    expect(response.body).not.toContain(blockedPath)
    expect(response.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR' } })
    expect(fixture.sqlite.prepare('SELECT avatar_key FROM auth_users').get()).toEqual({ avatar_key: null })
  })
})

function rawReply() {
  const reply = { header: () => reply, type: () => reply }
  return reply as Parameters<typeof serviceHandlers.updateCurrentUser>[1]
}
