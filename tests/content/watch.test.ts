import { expect, it } from 'vitest'
import { isTestSourceChange } from '../../scripts/runtime/tests.mjs'
it('watches content/schema changes while excluding compiler output on Windows', () => {
  expect(isTestSourceChange('apps/web/content', 'about\\index.mdx')).toBe(true)
  expect(isTestSourceChange('apps/web/build', 'content\\schema.ts')).toBe(true)
  expect(isTestSourceChange('apps/web/build', 'about\\definition.ts')).toBe(true)
  expect(isTestSourceChange('apps/web', 'source.config.ts')).toBe(true)
  expect(isTestSourceChange('apps/web', '.source\\index.ts')).toBe(false)
  expect(isTestSourceChange('apps/web', 'dist\\assets\\body.js')).toBe(false)
})
