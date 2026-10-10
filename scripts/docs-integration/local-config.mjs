import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { root, assertInstalledExui } from '../runtime/shared.mjs'

export class LocalError extends Error {
  constructor(code, next = 'check the root .env.local configuration') {
    super(`${code}; next: ${next}`); this.code = code
  }
}
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex')
export function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  renameSync(temporary, path)
}
export function readJson(path, code = 'LOCAL_CONFIG_INVALID') {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { throw new LocalError(code) }
}
export function toolchain({ workspace = root, inherited = process.env } = {}) {
  const node = inherited.INTEGRATION_NODE_BIN || process.execPath
  const corepack = inherited.INTEGRATION_COREPACK_JS || join(dirname(process.execPath), 'node_modules/corepack/dist/corepack.js')
  if (!existsSync(node) || !existsSync(corepack)) throw new LocalError('LOCAL_TOOLS_MISSING', 'set INTEGRATION_NODE_BIN / INTEGRATION_COREPACK_JS')
  const version = spawnSync(node, ['--version'], { encoding: 'utf8', shell: false })
  const outline = readJson(join(workspace, 'apps/outline/package.json'))
  try {
    const semver = createRequire(join(workspace, 'apps/outline/package.json'))('semver')
    if (version.status !== 0 || !semver.satisfies(version.stdout.trim(), outline.engines.node)) throw new Error()
  } catch { throw new LocalError('LOCAL_NODE_UNSUPPORTED', 'set INTEGRATION_NODE_BIN to a Node supported by apps/outline/package.json') }
  for (const script of ['dev:watch:integration', 'integration:check', 'integration:bootstrap']) {
    if (!outline.scripts?.[script]) throw new LocalError('OUTLINE_INTEGRATION_MISSING')
  }
  if (!existsSync(join(workspace, 'node_modules')) || !existsSync(join(workspace, 'apps/outline/node_modules')))
    throw new LocalError('LOCAL_DEPENDENCIES_MISSING', 'pnpm install; then install apps/outline with Corepack Yarn')
  if (spawnSync(node, [corepack, 'yarn', '--version'], { cwd: join(workspace, 'apps/outline'), encoding: 'utf8', shell: false }).status !== 0)
    throw new LocalError('LOCAL_COREPACK_UNAVAILABLE')
  try { assertInstalledExui(workspace) } catch {
    throw new LocalError('LOCAL_EXUI_ARTIFACTS_MISSING', 'pnpm install; then corepack yarn install in apps/outline; use the registry package')
  }
  return Object.freeze({ node, corepack })
}
