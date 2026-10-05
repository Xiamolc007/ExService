import { randomBytes } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const localRoot = join(root, '.local', 'docs-integration')
export const linkPath = join(root, 'vendor', 'exui')
const contextPath = join(localRoot, 'exui-context')

function packageExists(source) {
  return existsSync(join(source, 'packages', 'components', 'package.json')) &&
    existsSync(join(source, 'packages', 'tokens', 'package.json'))
}

function publicTypeEntries(packageJson) {
  const entries = []
  if (typeof packageJson.types === 'string') entries.push(packageJson.types)
  const visit = value => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (key === 'types' && typeof child === 'string') entries.push(child)
      else visit(child)
    }
  }
  visit(packageJson.exports)
  return entries
}

function assertPublicTypes(source) {
  for (const pkg of ['components', 'tokens']) {
    const packageRoot = join(source, 'packages', pkg)
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
    for (const entry of publicTypeEntries(packageJson)) {
      const absolute = resolve(packageRoot, entry)
      if (!absolute.startsWith(packageRoot + sep) || !existsSync(absolute)) {
        throw new Error(`ExUI public types missing: ${pkg}/${entry}; run the ExUI build first.`)
      }
    }
  }
}

export function resolveExuiSource(requested, link = linkPath) {
  const source = requested || (existsSync(link) ? realpathSync(link) : '')
  if (!source || !isAbsolute(source) || !packageExists(source)) {
    throw new Error('EXUI_SOURCE_DIR 必须指向包含 packages/components 和 packages/tokens 的绝对目录。')
  }
  if (!existsSync(join(source, 'packages', 'components', 'dist', 'exui.js')) ||
      !existsSync(join(source, 'packages', 'tokens', 'dist', 'index.js'))) {
    throw new Error('ExUI dist 缺失：先构建 tokens 和 @exre/exui。')
  }
  assertPublicTypes(source)
  return realpathSync(source)
}

export function ensureExuiLink(source, link = linkPath) {
  if (existsSync(link)) {
    if (!lstatSync(link).isSymbolicLink() || realpathSync(link) !== source) {
      throw new Error('vendor/exui 已存在且不是指向 EXUI_SOURCE_DIR 的链接；请手动核对。')
    }
    return
  }
  mkdirSync(dirname(link), { recursive: true })
  symlinkSync(source, link, process.platform === 'win32' ? 'junction' : 'dir')
}

export function prepareExuiContext(source) {
  if (resolve(contextPath) !== join(root, '.local', 'docs-integration', 'exui-context')) {
    throw new Error('ExUI 构建上下文目标不在本地集成目录。')
  }
  if (existsSync(contextPath)) {
    if (lstatSync(contextPath).isSymbolicLink()) throw new Error('ExUI 构建上下文不能是链接。')
    rmSync(contextPath, { recursive: true })
  }
  const entries = [
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json',
    'packages/tokens/package.json', 'packages/tokens/tsconfig.json',
    'packages/tokens/tsconfig.cjs.json', 'packages/tokens/src', 'packages/tokens/scripts',
    'packages/components/package.json', 'packages/components/tsconfig.json',
    'packages/components/tsconfig.lib.json', 'packages/components/tsconfig.node.json',
    'packages/components/vite.config.ts', 'packages/components/components.json',
    'packages/components/src', 'packages/components/scripts', 'packages/components/types',
  ]
  for (const entry of entries) {
    const from = join(source, entry)
    if (!existsSync(from)) throw new Error(`ExUI 源码缺少 ${entry}。`)
    const to = join(contextPath, entry)
    mkdirSync(dirname(to), { recursive: true })
    cpSync(from, to, { recursive: true, dereference: false })
  }
  return contextPath
}

function readEntries(path) {
  if (!existsSync(path)) return new Map()
  return new Map(readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
    const split = line.indexOf('=')
    if (split < 1) throw new Error('本地配置格式无效。')
    return [line.slice(0, split), line.slice(split + 1)]
  }))
}

export function configure(sourceInput = process.env.EXUI_SOURCE_DIR) {
  const source = resolveExuiSource(sourceInput)
  ensureExuiLink(source)
  if (!existsSync(join(root, 'apps', 'outline', 'package.json'))) {
    throw new Error('apps/outline submodule 缺失；先运行 git submodule update --init。')
  }
  mkdirSync(localRoot, { recursive: true })
  mkdirSync(join(localRoot, 'data', 'avatars'), { recursive: true })
  mkdirSync(join(localRoot, 'data', 'outline'), { recursive: true })
  const cleanContext = prepareExuiContext(source)
  const basePath = join(localRoot, 'secrets.env')
  const entries = readEntries(basePath)
  const keys = ['POSTGRES_PASSWORD', 'EXRE_PASSWORD', 'OUTLINE_PASSWORD', 'HYDRA_PASSWORD',
    'AUTH_CODE_HMAC_KEY', 'OUTLINE_SECRET_KEY', 'OUTLINE_UTILS_SECRET', 'HYDRA_SYSTEM_SECRET',
    'OUTLINE_INTEGRATION_KEY', 'IDENTITY_BOOTSTRAP_KEY', 'IDENTITY_DELIVERY_KEY', 'IDENTITY_FLOW_KEY',
    'OUTLINE_OIDC_CLIENT_SECRET', 'OIDC_PROBE_CLIENT_SECRET']
  for (const key of keys) {
    if (!entries.has(key)) entries.set(key, randomBytes(32).toString('hex'))
  }
  writeFileSync(basePath, [...entries].map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 })
  const sourcePath = source.split(sep).join('/')
  const cleanContextPath = cleanContext.split(sep).join('/')
  const full = [
    ...entries,
    ['EXUI_SOURCE_DIR', sourcePath],
    ['EXUI_BUILD_CONTEXT', cleanContextPath],
    ['WEBSITE_SERVER_UPSTREAM', 'server:8080'],
    ['WEBSITE_WEB_UPSTREAM', 'web:80'],
    ['OUTLINE_BACKEND_UPSTREAM', 'outline:3000'],
    ['OUTLINE_STATIC_UPSTREAM', 'outline:3000'],
    ['OUTLINE_STATIC_PREFIX', ''],
  ]
  const dev = [
    ...entries,
    ['EXUI_SOURCE_DIR', sourcePath],
    ['EXUI_BUILD_CONTEXT', cleanContextPath],
    ['WEBSITE_SERVER_UPSTREAM', `host.docker.internal:${process.env.INTEGRATION_SERVER_PORT ?? '18180'}`],
    ['WEBSITE_WEB_UPSTREAM', `host.docker.internal:${process.env.INTEGRATION_WEB_PORT ?? '18181'}`],
    ['OUTLINE_DIRECT_UPSTREAM', `host.docker.internal:${process.env.INTEGRATION_OUTLINE_PORT ?? '13100'}`],
    ['OUTLINE_HTTP_PORT', process.env.INTEGRATION_OUTLINE_HTTP_PORT ?? '13102'],
    ['OUTLINE_BACKEND_UPSTREAM', `host.docker.internal:${process.env.INTEGRATION_OUTLINE_HTTP_PORT ?? '13102'}`],
    ['OUTLINE_STATIC_UPSTREAM', `host.docker.internal:${process.env.INTEGRATION_OUTLINE_VITE_PORT ?? '13101'}`],
    ['OUTLINE_STATIC_PREFIX', 'docs/'],
  ]
  for (const [name, values] of [['full.env', full], ['dev.env', dev]]) {
    writeFileSync(join(localRoot, name), values.map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 })
  }
  return { source, localRoot }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    configure()
    console.log('本地集成配置已检查；未创建或迁移数据库。')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
