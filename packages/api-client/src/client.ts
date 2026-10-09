import type { paths } from '@api-client/src/generated/schema'
import type { ApiTransport } from './transport.js'

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'
type PathFor<M extends Method> = {
  [P in keyof paths]: paths[P][M] extends { responses: object } ? P : never
}[keyof paths] & string
type Operation<M extends Method, P extends PathFor<M>> = paths[P][M]
type ParamValue<O, K extends 'path' | 'query'> = O extends { parameters: infer Params }
  ? K extends keyof Params ? Exclude<Params[K], undefined> : never
  : never
type RequiredParam<O, K extends 'path' | 'query'> = O extends { parameters: infer Params }
  ? K extends keyof Params ? {} extends Pick<Params, K> ? false : true : false
  : false
type ParameterOptions<O> = ([ParamValue<O, 'path'>] extends [never] ? object : { path: ParamValue<O, 'path'> })
  & ([ParamValue<O, 'query'>] extends [never] ? object : RequiredParam<O, 'query'> extends true ? { query: ParamValue<O, 'query'> } : { query?: ParamValue<O, 'query'> })
type BodyOptions<O> = O extends { requestBody: { content: infer Content } }
  ? Content extends { 'multipart/form-data': unknown } ? { body: FormData }
    : Content extends { 'application/json': infer Body } ? { body: Body } : object
  : object
type RequiredOptions<O> = (RequiredParam<O, 'path'> extends true ? { params: ParameterOptions<O> }
  : RequiredParam<O, 'query'> extends true ? { params: ParameterOptions<O> } : object) & BodyOptions<O>
type HasRequired<O> = keyof RequiredOptions<O> extends never ? false : true

export interface ApiRequestOptions {
  headers?: Record<string, string>
  alert?: boolean
  timeout?: number
  signal?: AbortSignal
  responseType?: 'json' | 'text' | 'blob' | 'arraybuffer'
}
type Options<O> = ApiRequestOptions & { params?: ParameterOptions<O> } & RequiredOptions<O>
type Args<O> = HasRequired<O> extends true ? [options: Options<O>] : [options?: Options<O>]
type SuccessKey<R> = { [K in keyof R]: `${K & (string | number)}` extends `2${string}` ? K : never }[keyof R]
type SuccessResponse<O> = O extends { responses: infer R } ? R[SuccessKey<R>] : never
type JsonBody<O> = SuccessResponse<O> extends { content: infer C }
  ? C extends { 'application/json': infer Body } ? Body : void
  : void
type BodyFor<O, T> = T extends 'text' ? string : T extends 'blob' ? Blob
  : T extends 'arraybuffer' ? ArrayBuffer : JsonBody<O>

export interface ApiClient {
  GET<P extends PathFor<'get'>, T extends 'text' | 'blob' | 'arraybuffer'>(path: P, options: Options<Operation<'get', P>> & { responseType: T }): Promise<BodyFor<Operation<'get', P>, T>>
  GET<P extends PathFor<'get'>>(path: P, ...args: Args<Operation<'get', P>>): Promise<JsonBody<Operation<'get', P>>>
  POST<P extends PathFor<'post'>, T extends 'text' | 'blob' | 'arraybuffer'>(path: P, options: Options<Operation<'post', P>> & { responseType: T }): Promise<BodyFor<Operation<'post', P>, T>>
  POST<P extends PathFor<'post'>>(path: P, ...args: Args<Operation<'post', P>>): Promise<JsonBody<Operation<'post', P>>>
  PATCH<P extends PathFor<'patch'>, T extends 'text' | 'blob' | 'arraybuffer'>(path: P, options: Options<Operation<'patch', P>> & { responseType: T }): Promise<BodyFor<Operation<'patch', P>, T>>
  PATCH<P extends PathFor<'patch'>>(path: P, ...args: Args<Operation<'patch', P>>): Promise<JsonBody<Operation<'patch', P>>>
  PUT<P extends PathFor<'put'>, T extends 'text' | 'blob' | 'arraybuffer'>(path: P, options: Options<Operation<'put', P>> & { responseType: T }): Promise<BodyFor<Operation<'put', P>, T>>
  PUT<P extends PathFor<'put'>>(path: P, ...args: Args<Operation<'put', P>>): Promise<JsonBody<Operation<'put', P>>>
  DELETE<P extends PathFor<'delete'>, T extends 'text' | 'blob' | 'arraybuffer'>(path: P, options: Options<Operation<'delete', P>> & { responseType: T }): Promise<BodyFor<Operation<'delete', P>, T>>
  DELETE<P extends PathFor<'delete'>>(path: P, ...args: Args<Operation<'delete', P>>): Promise<JsonBody<Operation<'delete', P>>>
}

export interface CreateApiClientOptions {
  baseUrl: string
  transport: ApiTransport
}

function encodeQueryValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  throw new TypeError('Unsupported query parameter value')
}

export function createApiClient({ baseUrl, transport }: CreateApiClientOptions): ApiClient {
  if (typeof baseUrl !== 'string' || !baseUrl || typeof transport !== 'function') throw new TypeError('Invalid API client configuration')
  const origin = typeof location === 'undefined' ? undefined : location.origin
  const root = new URL(baseUrl, origin)
  if (!/^https?:$/.test(root.protocol)) throw new TypeError('API baseUrl must be HTTP(S)')

  function request(method: Method, path: string, supplied: object = {}): Promise<unknown> {
    const options = supplied as Record<string, unknown>
    const params = options.params as { path?: Record<string, unknown>; query?: Record<string, unknown> } | undefined
    const pathname = path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
      const value = params?.path?.[name]
      if (typeof value !== 'string' && typeof value !== 'number') throw new TypeError(`Missing path parameter: ${name}`)
      return encodeURIComponent(String(value))
    })
    const url = new URL(`${root.pathname.replace(/\/$/, '')}${pathname}`, root.origin)
    for (const [key, value] of Object.entries(params?.query ?? {})) {
      if (value === undefined) continue
      for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, encodeQueryValue(item))
    }
    const body = options.body
    const headers = { ...(options.headers as Record<string, string> | undefined) }
    if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json'
    return transport({
      url: url.href,
      method: method.toUpperCase(),
      headers,
      ...(body === undefined ? {} : { data: body }),
      ...(options.alert === undefined ? {} : { alert: options.alert as boolean }),
      ...(options.timeout === undefined ? {} : { timeout: options.timeout as number }),
      ...(options.signal === undefined ? {} : { signal: options.signal as AbortSignal }),
      ...(options.responseType === undefined ? {} : { responseType: options.responseType as 'json' | 'text' | 'blob' | 'arraybuffer' }),
    })
  }
  return {
    GET: (path: string, options?: object) => request('get', path, options),
    POST: (path: string, options?: object) => request('post', path, options),
    PATCH: (path: string, options?: object) => request('patch', path, options),
    PUT: (path: string, options?: object) => request('put', path, options),
    DELETE: (path: string, options?: object) => request('delete', path, options),
  } as ApiClient
}
