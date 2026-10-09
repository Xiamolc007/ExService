import { runLocal } from './docs-integration/local-dev.mjs'
import { LocalError } from './docs-integration/local-config.mjs'
try {
  const service = process.argv[2]
  if (process.argv.length !== 3 || !['web', 'server', 'outline'].includes(service)) throw new LocalError('DEV_SERVICE_ARGUMENTS_INVALID')
  await runLocal({ service })
} catch (error) {
  console.error(error instanceof LocalError ? error.message : 'LOCAL_SERVICE_START_FAILED; next: verify explicit local preparation')
  process.exitCode = 1
}
