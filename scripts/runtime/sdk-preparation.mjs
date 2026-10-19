import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { root } from './shared.mjs'
import { LocalError } from './local-config.mjs'
import { operatingEnvironment, environmentFile, withNodePath } from './settings.mjs'
import { runOwned } from './ownership.mjs'

/** Tool selection reads no runtime configuration or database secrets. */
export function preparationContext({ workspace = root, inherited = process.env, tools } = {}) {
  const configured = environmentFile(join(workspace, '.env.local'))
  if (!tools) {
    tools = { node: inherited.INTEGRATION_NODE_BIN ?? configured.INTEGRATION_NODE_BIN ?? process.execPath,
      corepack: inherited.INTEGRATION_COREPACK_JS ?? configured.INTEGRATION_COREPACK_JS ?? join(dirname(process.execPath), 'node_modules/corepack/dist/corepack.js') }
    if (!existsSync(tools.node) || !existsSync(tools.corepack)) throw new LocalError('RUNTIME_BUILD_TOOLS_MISSING')
  }
  return { tools, environment: withNodePath(operatingEnvironment(inherited), tools.node) }
}

export function sdkPreparationSpecifications(options = {}) {
  const workspace = options.workspace ?? root, { tools, environment } = preparationContext(options)
  return [
    { name: 'API Contract', command: tools.node, cwd: workspace,
      args: [join(workspace, 'scripts/api/generate.mjs'), 'generate'], environment },
    { name: '@workspace/sdk', command: tools.node, cwd: workspace,
      args: [tools.corepack, 'pnpm', '--filter', '@workspace/sdk', 'build'], environment },
  ]
}

/** Consumers begin only after both owned preparation processes finish successfully. */
export async function prepareSdk({ execute = runOwned, onLog, signal, ...options } = {}) {
  for (const specification of sdkPreparationSpecifications(options)) {
    signal?.throwIfAborted()
    await execute(specification, { onLog, signal })
  }
  signal?.throwIfAborted()
}
