import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { root } from './shared.mjs'
import { prepareSdk, preparationContext } from './sdk-preparation.mjs'
import { runOwned, signalScope } from './ownership.mjs'
import { reporter } from './output.mjs'
import { LocalError } from './local-config.mjs'

export function typecheckSpecifications(options = {}) {
  const { tools, environment } = preparationContext(options)
  return [
    { name: 'workspace', args: ['-r', 'typecheck'] },
    { name: 'SDK types', args: ['exec', 'tsc', '--noEmit', '-p', 'tests/sdk/types/tsconfig.json'] },
    { name: 'Server types', args: ['exec', 'tsc', '--noEmit', '-p', 'tests/server-types/tsconfig.json'] },
  ].map(spec => ({ ...spec, command: tools.node, cwd: options.workspace ?? root,
    args: [tools.corepack, 'pnpm', ...spec.args], environment }))
}
export async function main(options = {}, execute = runOwned, prepare = prepareSdk) {
  const scope = signalScope(), output = reporter({ verbose: options.verbose })
  try {
    await output.stage('Contract / SDK', onLog => prepare({ ...options, execute, onLog, signal: scope.signal }))
    for (const spec of typecheckSpecifications(options)) {
      scope.check()
      await output.stage(spec.name, onLog => execute(spec, { onLog, signal: scope.signal }))
    }
  } finally { scope.close() }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    if (args.length > 1 || args.some(value => value !== '--verbose')) throw new LocalError('TYPECHECK_ARGUMENTS_INVALID')
    await main({ verbose: args.includes('--verbose') })
  } catch { console.error('类型检查失败；检查上方准备和类型检查日志。'); process.exitCode = 1 }
}
