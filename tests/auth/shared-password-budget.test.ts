import { afterEach, expect, it, vi } from 'vitest'
import type { ScryptOptions } from 'node:crypto'
import { ScryptPasswordHasher } from '../../apps/mock-server/src/auth/crypto'

const work = vi.hoisted(() => ({
  callbacks: [] as Array<() => void>, active: 0, peak: 0, started: 0,
}))
vi.mock('node:crypto', async importOriginal => ({
  ...await importOriginal<typeof import('node:crypto')>(),
  // Replace only the expensive primitive. The production hasher and its gate run unchanged.
  scrypt(_password: string, _salt: Buffer, length: number, _options: ScryptOptions, callback: (error: Error | null, key: Buffer) => void) {
    work.active += 1
    work.peak = Math.max(work.peak, work.active)
    work.started += 1
    work.callbacks.push(() => { work.active -= 1; callback(null, Buffer.alloc(length)) })
  },
}))

afterEach(async () => {
  // Also drain held primitives when an assertion fails, so regressions do not hang cleanup.
  while (work.callbacks.length > 0) {
    work.callbacks.splice(0).forEach(finish => finish())
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  vi.restoreAllMocks()
  Object.assign(work, { callbacks: [], active: 0, peak: 0, started: 0 })
})

it('reserves a released slot for its waiter while a new request arrives before that waiter resumes', async () => {
  const hasher = new ScryptPasswordHasher()
  const accepted = [hasher.hash('first password'), hasher.hash('second password'), hasher.hash('waiting password')]
  expect(work.started).toBe(2)
  work.callbacks.shift()!()

  // Match the reviewed microtask interleaving: the original waiter has been notified,
  // but has not resumed when another public hash request arrives.
  await new Promise<void>(resolve => {
    let hops = 0
    const arrive = () => {
      if (++hops < 4) queueMicrotask(arrive)
      else { accepted.push(hasher.hash('interleaved password')); resolve() }
    }
    queueMicrotask(arrive)
  })
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(work.peak).toBe(2)
  expect(work.active).toBe(2)
  expect(work.started).toBe(3)

  // The interleaved request occupies one waiting place; exactly fifteen more fit.
  for (let index = 0; index < 15; index += 1) accepted.push(hasher.hash(`queued password ${index}`))
  await expect(hasher.hash('excess password')).rejects.toMatchObject({ code: 'AUTH_BUSY', retryAfterSeconds: 1 })
  expect(work.started).toBe(3)
  for (let finished = 1; finished < 19; finished += 1) {
    await vi.waitFor(() => expect(work.callbacks.length).toBeGreaterThan(0))
    work.callbacks.shift()!()
  }
  expect(await Promise.all(accepted)).toHaveLength(19)
  expect(work.started).toBe(19)
  expect(work.peak).toBe(2)
  expect(work.active).toBe(0)

  const recovered = hasher.hash('after queue drained')
  expect(work.active).toBe(1)
  work.callbacks.shift()!()
  await expect(recovered).resolves.toMatch(/^scrypt\$v1\$/)
  expect(work.active).toBe(0)
})
