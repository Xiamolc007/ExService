// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('protects invitation URL material before the browser loads any entry resource', () => {
  const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8')
  const entry = new DOMParser().parseFromString(html, 'text/html')
  const policies = entry.querySelectorAll('meta[name="referrer"]')

  expect(policies).toHaveLength(1)
  const policy = policies[0]!
  expect(policy.parentElement).toBe(entry.head)
  expect(policy.getAttribute('content')).toBe('no-referrer')

  const resources = entry.querySelectorAll('script, link[href], [src], [srcset], style')
  expect(resources.length).toBeGreaterThan(0)
  for (const resource of resources) {
    expect(policy.compareDocumentPosition(resource) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  }
})
