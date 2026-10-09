import { spawn, spawnSync } from 'node:child_process'
import { watch } from 'node:fs'
import { isAbsolute, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Determines the required ExUI package rebuild from a native watcher event. */
export function changedTargets(target, directory, filename) {
  const path = typeof filename === 'string'
    ? normalize(isAbsolute(filename) ? relative(directory, filename) : filename).replace(/\\/g, '/') : undefined
  if (path === '..' || path?.startsWith('../')) return []
  const generatedCss = target === 'tokens' && directory.replace(/\\/g, '/').endsWith('/tokens/src') && path === 'style.css'
  if (generatedCss) return []
  return target === 'tokens' ? ['tokens', 'components'] : ['components']
}

/** Watches linked ExUI source and serially rebuilds its original public packages. */
export function watchExui({ root = process.cwd(), pnpm = process.env.npm_execpath,
  corepack = process.env.INTEGRATION_COREPACK_JS } = {}) {
  if (!pnpm && !corepack) throw new Error('The ExUI integration watcher requires its pnpm or Corepack executable')
  const pending = new Set()
  const watchers = []
  let active = false
  let stopped = false
  let debounce
  let child
  const run = args => new Promise((resolveBuild, reject) => {
    child = spawn(process.execPath, pnpm ? [pnpm, ...args] : [corepack, 'pnpm', ...args], {
      cwd: root, stdio: 'inherit', shell: false,
    })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolveBuild() : reject(new Error('ExUI package build failed')))
  })
  const build = async () => {
    if (active || stopped || pending.size === 0) return
    active = true
    const tokens = pending.has('tokens')
    const components = pending.has('components')
    pending.clear()
    try {
      if (tokens) await run(['--filter', '@exre/exui-tokens', 'build'])
      if (components && !stopped) await run(['--filter', '@exre/exui', 'build'])
    } catch { if (!stopped) console.error('ExUI build failed; repair the source and save again to retry.') }
    finally { child = undefined; active = false; if (pending.size && !stopped) void build() }
  }
  for (const target of ['tokens', 'components']) {
    for (const location of ['src', 'scripts']) {
      const directory = resolve(root, 'packages', target, location)
      watchers.push(watch(directory, { recursive: true }, (_event, filename) => {
        for (const item of changedTargets(target, directory, filename)) pending.add(item)
        if (!pending.size) return
        clearTimeout(debounce)
        debounce = setTimeout(() => void build(), 150)
      }))
    }
  }
  const stop = () => {
    stopped = true
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
    clearTimeout(debounce)
    for (const watcher of watchers) watcher.close()
    if (child && child.exitCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', shell: false })
      else child.kill('SIGTERM')
    }
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  console.log('Watching linked ExUI source; generated token CSS does not trigger rebuilds.')
  pending.add('tokens'); pending.add('components'); void build()
  return stop
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) watchExui()
