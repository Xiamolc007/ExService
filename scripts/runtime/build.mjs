import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { root } from './shared.mjs'
import { runOwned } from '../docs-integration/ownership.mjs'
import { LocalError } from '../docs-integration/local-config.mjs'
import { operatingEnvironment, environmentFile, withNodePath } from './settings.mjs'
import { reporter } from './output.mjs'

/** Build needs no runtime receipt, database, Docker or backend credentials. */
export function buildSpecifications({ workspace = root, inherited = process.env } = {}) {
  const configured = environmentFile(join(workspace, '.env.local'))
  const node = inherited.INTEGRATION_NODE_BIN ?? configured.INTEGRATION_NODE_BIN ?? process.execPath,
    corepack = inherited.INTEGRATION_COREPACK_JS ?? configured.INTEGRATION_COREPACK_JS ?? join(dirname(process.execPath), 'node_modules/corepack/dist/corepack.js')
  if (!existsSync(node) || !existsSync(corepack)) throw new LocalError('RUNTIME_BUILD_TOOLS_MISSING')
  const os = withNodePath(operatingEnvironment(inherited), node)
  const publicEnv = { ...os, NODE_ENV: 'production', VITE_API_BASE_URL: '/api' }
  const outlineEnv = { ...os, NODE_ENV: 'production', RUNTIME_ENV_INJECTED: 'true', WEBSITE_INTEGRATION_ENABLED: 'true',
    WEBSITE_INTEGRATION_MODE: 'deployment', URL: 'https://build.invalid/docs', WEBSITE_URL: 'https://build.invalid/', HYDRA_PUBLIC_URL: 'https://issuer.build.invalid/',
    OUTLINE_OIDC_CLIENT_ID: 'ex-outline', WEBSITE_INTERNAL_URL: 'http://server:8080/' }
  return [
    ...['@workspace/sdk', '@workspace/web', '@workspace/server'].map(name => ({ name, command: node, cwd: workspace,
      args: [corepack, 'pnpm', '--filter', name, 'build'], environment: publicEnv })),
    // Package existing catalogs without regenerating and overwriting translators' source changes.
    ...['clean', 'vite:build', 'copy:i18n', 'build:server'].map(action => ({ name: `outline-${action}`, command: node, cwd: join(workspace, 'apps/outline'),
      args: [corepack, 'yarn', action], environment: outlineEnv })),
  ]
}
export async function main(options = {}, execute = runOwned) {
  const output = reporter({ verbose: options.verbose })
  output.title('构建 Website 与 Outline（不启动后台服务）')
  for (const spec of buildSpecifications(options)) {
    try { await output.stage(spec.name, onLog => execute(spec, { onLog })) }
    catch { throw new LocalError(`RUNTIME_BUILD_FAILED:${spec.name}`, 'fix this build stage; no infrastructure was changed') }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some(value => value !== '--verbose') || process.argv.slice(2).length > 1) throw new LocalError('RUNTIME_BUILD_ARGUMENTS_INVALID')
    await main({ verbose: process.argv.includes('--verbose') })
  } catch (error) { console.error(error instanceof LocalError ? error.message : 'RUNTIME_BUILD_FAILED'); process.exitCode = 1 }
}
