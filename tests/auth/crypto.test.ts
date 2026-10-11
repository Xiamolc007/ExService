import { describe, expect, it } from 'vitest'
import { parseAuthCodeHmacKey, ScryptPasswordHasher } from '@server/src/modules/auth/crypto'

describe('authentication crypto', () => {
  it('round-trips the production scrypt encoding and rejects another password', async () => {
    const hasher = new ScryptPasswordHasher()
    const encoded = await hasher.hash('correct horse battery staple')

    expect(encoded).toMatch(/^scrypt\$v1\$N=32768,r=8,p=1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/)
    await expect(hasher.verify('correct horse battery staple', encoded)).resolves.toBe(true)
    await expect(hasher.verify('wrong password', encoded)).resolves.toBe(false)
    await expect(hasher.verify('correct horse battery staple', 'invalid')).resolves.toBe(false)
  })

  it('requires exactly 32 bytes of hex-encoded HMAC key material', () => {
    expect(parseAuthCodeHmacKey('ab'.repeat(32))).toEqual(Buffer.alloc(32, 0xab))
    expect(() => parseAuthCodeHmacKey('ab'.repeat(31))).toThrow(/AUTH_CODE_HMAC_KEY/)
    expect(() => parseAuthCodeHmacKey(undefined)).toThrow(/AUTH_CODE_HMAC_KEY/)
  })
})
