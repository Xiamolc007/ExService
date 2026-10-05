import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LocalError } from '../docs-integration/local-config.mjs'

/** A fresh Linux build context contains source and lockfiles, never host modules or secrets. */
export function prepareImageContext(source, destination) {
  const original = realpathSync(source), target = resolve(destination)
  if (existsSync(target) || !existsSync(join(original, 'packages/components/package.json')) || !existsSync(join(original, 'packages/tokens/package.json')))
    throw new LocalError('IMAGE_CONTEXT_INVALID', 'use the existing ExUI checkout and a fresh output directory')
  mkdirSync(target, { recursive: true })
  const blocked = new Set(['.git', 'node_modules', 'dist', 'build', 'output'])
  for (const entry of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'packages', 'scripts', 'types']) {
    const path = join(original, entry)
    if (!existsSync(path)) continue
    cpSync(path, join(target, entry), { recursive: true, dereference: false,
      filter: candidate => !blocked.has(basename(candidate)) && !basename(candidate).startsWith('.env') && !lstatSync(candidate).isSymbolicLink() })
  }
  return target
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new LocalError('IMAGE_CONTEXT_ARGUMENTS_INVALID')
    console.log(prepareImageContext(process.argv[2], process.argv[3]))
  } catch (error) { console.error(error instanceof LocalError ? error.message : 'IMAGE_CONTEXT_FAILED'); process.exitCode = 1 }
}
