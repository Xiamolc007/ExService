export interface HttpTransportRequest {
  url: string
  method?: string
  params?: Record<string, unknown> | URLSearchParams
  data?: unknown
  headers?: Record<string, string>
  timeout?: number
  signal?: AbortSignal
  responseType?: 'json' | 'text' | 'blob' | 'arraybuffer'
  alert?: boolean
}

export type ApiTransport = (request: HttpTransportRequest) => Promise<unknown>
