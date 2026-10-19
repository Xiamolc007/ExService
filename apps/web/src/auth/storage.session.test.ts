// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { AUTH_TOKEN_KEY, SSO_SUCCESS_KEY, clearBrowserSession, readRawToken, readToken, syncSessionToken, writeToken } from './storage'
import { setAccessToken } from '@workspace/sdk'
vi.mock('@workspace/sdk', async importOriginal => ({ ...await importOriginal<object>(), setAccessToken: vi.fn() }))
afterEach(() => { vi.restoreAllMocks(); window.localStorage.clear(); window.sessionStorage.clear(); syncSessionToken(); vi.mocked(setAccessToken).mockClear() })

it('suppresses a token whose deletion failed, then restores the same token only after successful login persistence', () => {
  window.localStorage.setItem(AUTH_TOKEN_KEY, 'same-token')
  window.sessionStorage.setItem(SSO_SUCCESS_KEY, 'old-record')
  const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key: string) {
    if (this === window.localStorage) throw new Error('denied')
    Storage.prototype.clear.call(this)
  })
  clearBrowserSession()
  expect(readRawToken(window.localStorage)).toBe('same-token')
  expect(readToken(window.localStorage)).toBeNull()
  expect(syncSessionToken()).toBeNull()
  expect(window.sessionStorage.getItem(SSO_SUCCESS_KEY)).toBeNull()
  expect(setAccessToken).toHaveBeenLastCalledWith(null)
  remove.mockRestore()
  writeToken(window.localStorage, 'same-token')
  expect(readToken(window.localStorage)).toBe('same-token')
  expect(setAccessToken).toHaveBeenLastCalledWith('same-token')
})

it('does not hide a new cross-tab token with the UI suppression of a failed logout', () => {
  window.localStorage.setItem(AUTH_TOKEN_KEY, 'old-token')
  const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied') })
  clearBrowserSession()
  remove.mockRestore()
  window.localStorage.setItem(AUTH_TOKEN_KEY, 'new-token')
  expect(readRawToken(window.localStorage)).toBe('new-token')
  expect(syncSessionToken()).toBe('new-token')
  expect(readToken(window.localStorage)).toBe('new-token')
})

it('keeps suppression across unreadable storage and does not set credentials when login persistence fails', () => {
  window.localStorage.setItem(AUTH_TOKEN_KEY, 'old-token')
  const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied') })
  clearBrowserSession()
  remove.mockRestore()
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable') })
  expect(syncSessionToken()).toBeUndefined()
  read.mockRestore()
  expect(readToken(window.localStorage)).toBeNull()
  vi.mocked(setAccessToken).mockClear()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
  expect(() => writeToken(window.localStorage, 'old-token')).toThrow('denied')
  expect(setAccessToken).not.toHaveBeenCalled()
  expect(readToken(window.localStorage)).toBeNull()
})
