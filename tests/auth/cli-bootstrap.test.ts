import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { afterEach, expect, it, vi } from 'vitest'
import { createAppAuthService } from '../../apps/mock-server/src/cli/support'
import { openDatabase } from '../../apps/mock-server/src/db/client'

const isolated = vi.hoisted(() => ({ exists: true, sqlite: undefined as Database.Database | undefined }))
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: (path: unknown) => path === 'isolated-auth-cli.sqlite' ? isolated.exists : actual.existsSync(path as string) }
})
vi.mock('../../apps/mock-server/src/db/client', () => ({
  DATABASE_PATH: 'isolated-auth-cli.sqlite',
  openDatabase: vi.fn(() => {
    if (!isolated.sqlite) throw new Error('isolated test connection was not prepared')
    return { sqlite: isolated.sqlite }
  }),
}))

afterEach(() => {
  if (isolated.sqlite?.open) isolated.sqlite.close()
  isolated.sqlite = undefined
  isolated.exists = true
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function authOnlyDatabase() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  for (const tag of ['0001_auth', '0002_remove-registration-qq']) {
    sqlite.exec(readFileSync(new URL(`../../apps/mock-server/drizzle/${tag}.sql`, import.meta.url), 'utf8').replaceAll('--> statement-breakpoint', ''))
  }
  sqlite.exec('DROP TABLE auth_registrations; DROP TABLE auth_email_delivery')
  isolated.sqlite = sqlite
  return sqlite
}

it('bootstraps SSO with only authentication tables and no HMAC, join, profile or community structure', () => {
  vi.stubEnv('AUTH_CODE_HMAC_KEY', undefined)
  const sqlite = authOnlyDatabase()
  expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all())
    .toEqual([{ name: 'auth_sessions' }, { name: 'auth_sso_requests' }, { name: 'auth_users' }])
  expect((sqlite.pragma('table_info(auth_users)') as Array<{ name: string }>).map(column => column.name))
    .toEqual(['id', 'email', 'nickname', 'password_hash', 'created_at'])
  const close = vi.spyOn(sqlite, 'close')
  const cli = createAppAuthService()
  const request = cli.authServices.createSsoRequest()
  expect(cli.authServices.inspectSsoRequest(request.ssoRequestId)).toMatchObject({
    ssoRequestId: request.ssoRequestId, status: 'pending', expiresAt: request.expiresAt,
  })
  expect(cli.authServices.inspectSsoRequestForCli(request.ssoRequestId)).toEqual({ status: 'pending', expiresAt: request.expiresAt, userId: null })
  expect(cli.authServices.inspectSsoRequestForCli('a'.repeat(43))).toEqual({ status: 'not-found' })
  expect(openDatabase).toHaveBeenCalledTimes(1)
  cli.close()
  expect(close).toHaveBeenCalledTimes(1)
  expect(sqlite.open).toBe(false)
})

it('rejects incomplete authentication structure and closes the opened test connection', () => {
  vi.stubEnv('AUTH_CODE_HMAC_KEY', undefined)
  const sqlite = authOnlyDatabase()
  sqlite.exec('DROP TABLE auth_sso_requests')
  const close = vi.spyOn(sqlite, 'close')
  expect(() => createAppAuthService()).toThrow('pnpm db:migrate')
  expect(openDatabase).toHaveBeenCalledTimes(1)
  expect(close).toHaveBeenCalledTimes(1)
  expect(sqlite.open).toBe(false)
})

it('fails the fixed-path existence check without opening a connection', () => {
  isolated.exists = false
  expect(() => createAppAuthService()).toThrow('pnpm db:migrate')
  expect(openDatabase).not.toHaveBeenCalled()
})
