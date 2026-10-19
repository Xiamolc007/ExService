import { ExMessage } from '@exre/exui'
import { createHttpCore, type ExAxiosOptions, type HttpRuntime } from './core.js'

const tokenKey = 'exwebsite.auth.token'
const origin = typeof location === 'undefined' ? undefined : location.origin
const runtime: HttpRuntime = {
  environment: 'browser',
  origin,
  readToken: () => {
    try {
      return localStorage.getItem(tokenKey)
    } catch {
      return undefined
    }
  },
  clearToken: (token) => {
    try {
      if (localStorage.getItem(tokenKey) !== token) return false
      if (token !== null) localStorage.removeItem(tokenKey)
      return true
    } catch {
      return false
    }
  },
  notify: (message) => ExMessage.error(message),
  navigate: (url) => {
    if (typeof location === 'undefined') return
    const target = new URL(url, location.href)
    if (
      location.origin !== target.origin ||
      location.pathname !== target.pathname ||
      location.search !== target.search
    )
      location.replace(target.href)
  },
}

export const ExAxios = createHttpCore(runtime)
export function createExAxios(options: ExAxiosOptions = {}) {
  return createHttpCore(runtime, options)
}
export { ExAxiosError } from './core.js'
export type {
  ExAxiosOptions,
  ExAxiosInstance,
  ExAxiosRequestConfig,
  ExAxiosErrorKind,
  SessionExpiredContext,
} from './core.js'
export { createApiClient } from '@workspace/api-client'
export type {
  ApiClient,
  CreateApiClientOptions,
  paths,
  operations,
  components,
} from '@workspace/api-client'
