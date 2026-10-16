import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from '@api-client/src/client'
import { readFileSync } from 'node:fs'
import { readContract } from '@tests/helpers/contract'

describe('typed API transport', () => {
  it('supports every declared path and query serialization style in the contract', () => {
    const contract = readContract(new URL('../../api/generated/openapi.json', import.meta.url)) as { paths: Record<string, Record<string, { parameters?: Array<{ name: string; in: string; style?: string; explode?: boolean; schema?: { type?: string } }> }>> }
    for (const [path, item] of Object.entries(contract.paths)) for (const [method, operation] of Object.entries(item)) {
      if (!operation || !Array.isArray(operation.parameters)) continue
      for (const parameter of operation.parameters) {
        if (parameter.in === 'path') {
          expect(parameter.style ?? 'simple', `${method} ${path} ${parameter.name}`).toBe('simple')
          expect(parameter.explode ?? false).toBe(false)
        } else if (parameter.in === 'query') {
          expect(parameter.style ?? 'form', `${method} ${path} ${parameter.name}`).toBe('form')
          expect(parameter.explode ?? true).toBe(true)
        } else throw new Error(`Unsupported parameter location: ${method} ${path} ${parameter.name}`)
        expect(parameter.schema?.type ?? 'string').not.toBe('object')
      }
    }
  })
  it('builds a complete URL and encodes a path parameter', async () => {
    const transport = vi.fn(async () => ({ status: 'ok' }))
    const client = createApiClient({ baseUrl: 'https://example.test/api', transport })
    await client.GET('/notifications/{notificationId}', {
      params: { path: { notificationId: 'part one' } },
    })
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.test/api/notifications/part%20one',
      method: 'GET',
    }))
  })

  it('serializes declared form query fields and omits undefined fields', async () => {
    const transport = vi.fn(async () => ({ items: [] }))
    const client = createApiClient({ baseUrl: 'https://example.test/api', transport })
    await client.GET('/notifications', { params: { query: { view: 'unread', limit: 20, cursor: undefined } } })
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.test/api/notifications?view=unread&limit=20' }))
  })

  it('passes multipart FormData unchanged without supplying a content type', async () => {
    const transport = vi.fn(async () => ({ status: 'stored' }))
    const client = createApiClient({ baseUrl: 'https://example.test/api', transport })
    const body = new FormData()
    body.append('file', new Blob(['file bytes'], { type: 'text/plain' }), 'file.txt')
    await client.POST('/storage/uploads', { body })
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({ data: body, headers: {} }))
  })
})
