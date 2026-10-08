import { expect, it } from 'vitest'
import { docsResumeUrl } from './docsResumeNavigation'
it('returns through the root controller and encodes the reading target as one value', () => {
  const target = '/docs/search?q=hello&collectionId=12345678-1234-1234-1234-123456789abc'
  const url = new URL(docsResumeUrl(target), 'https://example.test')
  expect(url.pathname).toBe('/docs/')
  expect(url.searchParams.getAll('docsResume')).toEqual([target])
})
