export const AUTH_TOKEN_KEY = 'exwebsite.auth.token'
export const SSO_SUCCESS_KEY = 'exwebsite.auth.sso-success'

export function readToken(storage: Pick<Storage, 'getItem'>): string | null {
  return storage.getItem(AUTH_TOKEN_KEY)
}

export function writeToken(storage: Pick<Storage, 'setItem'>, token: string): void {
  storage.setItem(AUTH_TOKEN_KEY, token)
}

export function removeMatchingToken(storage: Pick<Storage, 'getItem' | 'removeItem'>, token: string): void {
  if (storage.getItem(AUTH_TOKEN_KEY) === token) {
    storage.removeItem(AUTH_TOKEN_KEY)
  }
}

export function writeSsoSuccess(
  storage: Pick<Storage, 'setItem'>,
  record: { ssoRequestId: string; confirmedAt: number },
): void {
  storage.setItem(SSO_SUCCESS_KEY, JSON.stringify(record))
}

export function readRecentSsoSuccess(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  now: number,
): { ssoRequestId: string; confirmedAt: number } | null {
  const raw = storage.getItem(SSO_SUCCESS_KEY)
  if (raw === null) {
    return null
  }
  try {
    const value = JSON.parse(raw) as { ssoRequestId?: unknown; confirmedAt?: unknown }
    if (
      typeof value.ssoRequestId !== 'string'
      || !/^[A-Za-z0-9_-]{43}$/.test(value.ssoRequestId)
      || typeof value.confirmedAt !== 'number'
      || !Number.isSafeInteger(value.confirmedAt)
      || now - value.confirmedAt < 0
      || now - value.confirmedAt > 5 * 60 * 1000
    ) {
      storage.removeItem(SSO_SUCCESS_KEY)
      return null
    }
    return { ssoRequestId: value.ssoRequestId, confirmedAt: value.confirmedAt }
  } catch {
    storage.removeItem(SSO_SUCCESS_KEY)
    return null
  }
}
