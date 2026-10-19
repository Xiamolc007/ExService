import { createHttpCore, type ExAxiosOptions } from './core.js'

export const ExAxios = createHttpCore({ environment: 'node' })
export function createExAxios(options: ExAxiosOptions = {}) {
  return createHttpCore({ environment: 'node' }, options)
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
