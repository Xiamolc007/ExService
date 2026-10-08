import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { assertInstalledExui, ensureExuiLink, resolveExuiSource } from './configure.mjs'

test('runtime accepts installed registry ExUI without a source checkout and rejects missing public artifacts', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'exui-registry-'))
  try {
    const consumers = ['apps/web', 'packages/components', 'packages/sdk', 'apps/outline']
    for (const consumer of consumers) {
      const packageRoot = join(workspace, consumer, 'node_modules/@exre/exui')
      mkdirSync(join(packageRoot, 'dist'), { recursive: true })
      writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
        name: '@exre/exui', version: '0.7.0',
        exports: { '.': { import: './dist/exui.js', types: './dist/index.d.ts' },
          './tokens': { import: './dist/tokens.js' } },
      }))
      for (const file of ['exui.js', 'index.d.ts', 'tokens.js']) writeFileSync(join(packageRoot, 'dist', file), '')
    }
    assert.doesNotThrow(() => assertInstalledExui(workspace))
    rmSync(join(workspace, 'apps/outline/node_modules/@exre/exui/dist/tokens.js'))
    assert.throws(() => assertInstalledExui(workspace), /apps\/outline.*tokens/)
  } finally { rmSync(workspace, { recursive: true, force: true }) }
})

test('configure rejects an ExUI checkout without built public artifacts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'exui-config-'))
  try {
    mkdirSync(join(dir, 'packages', 'components'), { recursive: true })
    mkdirSync(join(dir, 'packages', 'tokens'), { recursive: true })
    writeFileSync(join(dir, 'packages', 'components', 'package.json'), '{}')
    writeFileSync(join(dir, 'packages', 'tokens', 'package.json'), '{}')
    assert.throws(() => resolveExuiSource(dir), /ExUI dist 缺失/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('configure preserves an existing link to a different checkout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'exui-config-'))
  try {
    const first = join(dir, 'first')
    const second = join(dir, 'second')
    mkdirSync(first)
    mkdirSync(second)
    symlinkSync(first, join(dir, 'exui'), process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => ensureExuiLink(second, join(dir, 'exui')), /已存在/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('configure rejects public ExUI artifacts without their type declarations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'exui-config-'))
  try {
    for (const pkg of ['components', 'tokens']) {
      mkdirSync(join(dir, 'packages', pkg, 'dist'), { recursive: true })
      writeFileSync(join(dir, 'packages', pkg, 'package.json'), JSON.stringify({
        types: pkg === 'components' ? './types/index.d.ts' : './dist/index.d.ts',
        exports: { '.': { types: pkg === 'components' ? './types/index.d.ts' : './dist/index.d.ts' } },
      }))
    }
    writeFileSync(join(dir, 'packages/components/dist/exui.js'), '')
    writeFileSync(join(dir, 'packages/tokens/dist/index.js'), '')
    assert.throws(() => resolveExuiSource(dir), /ExUI.*types.*build/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
