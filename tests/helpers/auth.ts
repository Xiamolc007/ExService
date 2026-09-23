import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { AuthService, type AuthServiceDependencies } from '../../apps/mock-server/src/auth/service'
import type { PasswordHasher } from '../../apps/mock-server/src/auth/crypto'

const migrationPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../apps/mock-server/drizzle',
)

const testPasswordHasher: PasswordHasher = {
  async hash(password) {
    return `test-password:${password}`
  },
  async verify(password, encodedHash) {
    return encodedHash === `test-password:${password}`
  },
}

export function createTestAuth(overrides: Partial<AuthServiceDependencies> = {}) {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const journal = JSON.parse(readFileSync(resolve(migrationPath, 'meta/_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> }
  sqlite.transaction(() => {
    for (const { tag } of journal.entries) {
      sqlite.exec(readFileSync(resolve(migrationPath, `${tag}.sql`), 'utf8').replaceAll('--> statement-breakpoint', ''))
    }
  })()

  let randomCounter = 0
  const deliveries: Array<{ email: string; code: string }> = []
  let currentTime = 1_800_000_000_000

  const authServices = new AuthService({
    sqlite,
    codeHmacKey: Buffer.alloc(32, 7),
    now: () => currentTime,
    randomBytes: (length) => {
      randomCounter += 1
      const bytes = Buffer.alloc(length)
      bytes.writeUInt32BE(randomCounter, Math.max(0, length - 4))
      return bytes
    },
    randomInteger: () => 123456,
    createUserId: () => '10000000-0000-4000-8000-000000000001',
    passwordHasher: testPasswordHasher,
    deliverVerificationCode: (email, code) => {
      deliveries.push({ email, code })
    },
    ...overrides,
  })

  return {
    sqlite,
    authServices,
    deliveries,
    advance(milliseconds: number) {
      currentTime += milliseconds
    },
    close() {
      sqlite.close()
    },
  }
}
