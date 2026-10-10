import { join } from 'node:path'
import { appendFileSync } from 'node:fs'
import { runOwned, signalScope } from '../docs-integration/ownership.mjs'
import { acquireApplicationLock } from './application-lock.mjs'
import { toolchain } from '../docs-integration/local-config.mjs'
import { httpReady, assertPortFree, supervise, specifications, verifyFoundationSchemas } from '../docs-integration/local-dev.mjs'
import { verifyHydraClient } from '../docs-integration/hydra-client.mjs'
import { withNodePath } from './settings.mjs'
import { reporter, RuntimeError } from './output.mjs'

export const hydraOptions = state => ({ mode: state.profile, adminUrl: state.internal.hydra, publicUrl: state.config.issuer,
  publicOrigin: state.config.publicOrigin, callback: state.config.callback, clientId: state.config.clientId,
  clientSecret: state.values.OUTLINE_OIDC_CLIENT_SECRET })

export function cliSpecification(state, tools, service, action, args = []) {
  return { name: service, command: tools.node, cwd: service === 'outline' ? join(state.workspace, 'apps/outline') : state.workspace,
    args: service === 'outline' ? [join(state.workspace, `apps/outline/build/server/scripts/${action}.js`), ...args]
      : [join(state.workspace, 'scripts/runtime/server.mjs'), action, ...args],
    environment: withNodePath(state.environments[service], tools.node) }
}

/** All preparation checks are read-only; database markers replace configurable hash receipts. */
export async function verifyApplications(state, { execute = runOwned, tools = toolchain({ workspace: state.workspace, inherited: state.values }),
  verifySchemas = verifyFoundationSchemas, verifyClient = verifyHydraClient, onLog = () => {}, signal } = {}) {
  await verifySchemas(state, { bootstrap: true })
  await execute(cliSpecification(state, tools, 'server', 'integration:check'), { onLog, signal, code: 'WEBSITE_NOT_READY', next: 'pnpm db:migrate' })
  await execute(cliSpecification(state, tools, 'outline', 'integration-check'), { onLog, signal, code: 'OUTLINE_NOT_READY', next: 'pnpm infra bootstrap --admin-user-id <UUID>' })
  await verifyClient(hydraOptions(state))
}

/** Watch processes own only their child generation. Dependency services are never stopped here. */
export async function runDevelopment(state, { service, verbose = false } = {}) {
  if (state.profile !== 'local') throw new RuntimeError('LOCAL_PROFILE_REQUIRED')
  const tools = toolchain({ workspace: state.workspace, inherited: state.values })
  const lock = acquireApplicationLock(state)
  const scope = signalScope(), output = reporter({ environment: state.values, verbose })
  const logFile = join(state.directory, `applications-${lock.record.runId}.log`)
  const onLog = (name, line) => {
    const safe = reporter({ environment: state.values, write: value => { appendFileSync(logFile, `${value}\n`); console.log(value) } })
    safe.log(name, line)
  }
  let handedOff = false
  try {
    output.title('启动 Website 与 Outline 开发监听')
    await verifyApplications(state, { tools, onLog, signal: scope.signal })
    for (const port of [state.config.ports.public, state.config.ports.web, state.config.ports.api, state.config.ports.outline, state.config.ports.outlineVite]) await assertPortFree(port)
    scope.check(); scope.close(); handedOff = true
    await supervise({ mode: 'local', fingerprint: state.fingerprint, directory: state.directory, controlDirectory: state.directory,
      lock, specifications: specifications(state, tools).filter(spec => !service || spec.name === service), onLog,
      banner: `LOCAL_READY 网站 ${state.config.publicOrigin}/；文档 ${state.config.publicOrigin}/docs/；Ctrl+C 结束应用`,
      readiness: async children => {
        if (!service || service === 'server') await httpReady(new URL('/api/health', state.internal.website), { children })
        if (!service || service === 'outline') {
          await httpReady(new URL('/_health', state.internal.outline), { children })
          await httpReady(`http://127.0.0.1:${state.config.ports.outlineVite}/docs/static/@vite/client`, { children })
        }
        if (!service || service === 'web') await httpReady(`${state.config.publicOrigin}/`, { children })
        if (!service) {
          await httpReady(`${state.config.publicOrigin}/api/health`, { children })
          await httpReady(`${state.config.publicOrigin}/docs/`, { children })
        }
      },
    })
  } finally { scope.close(); if (!handedOff) lock.release() }
}
