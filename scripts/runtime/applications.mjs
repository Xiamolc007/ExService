import { join } from 'node:path'
import { appendFileSync } from 'node:fs'
import { runOwned, signalScope } from '../docs-integration/ownership.mjs'
import { acquireApplicationLock } from './application-lock.mjs'
import { toolchain } from '../docs-integration/local-config.mjs'
import { httpReady, assertPortFree, supervise, specifications, verifyFoundationSchemas } from '../docs-integration/local-dev.mjs'
import { verifyHydraClient } from '../docs-integration/hydra-client.mjs'
import { withNodePath } from './settings.mjs'
import { reporter, RuntimeError, diagnostic } from './output.mjs'

export const hydraOptions = state => ({ mode: state.profile, adminUrl: state.internal.hydra, publicUrl: state.config.issuer,
  publicOrigin: state.config.publicOrigin, callback: state.config.callback, clientId: state.config.clientId,
  clientSecret: state.values.OUTLINE_OIDC_CLIENT_SECRET })

export function cliSpecification(state, tools, service, action, args = []) {
  return { name: service, command: tools.node, cwd: service === 'outline' ? join(state.workspace, 'apps/outline') : state.workspace,
    args: service === 'outline' ? [join(state.workspace, `apps/outline/build/server/scripts/${action}.js`), ...args]
      : [join(state.workspace, 'scripts/runtime/server.mjs'), action, ...args],
    environment: withNodePath(state.environments[service], tools.node) }
}

/** Keep Hydra client/configuration failures distinct from network errors without returning raw messages. */
export async function verifyRuntimeHydraClient(state, verifyClient = verifyHydraClient) {
  try { return await verifyClient(hydraOptions(state)) }
  catch (error) {
    const context = { service: 'Hydra', phase: 'OIDC client 检查', keys: ['HYDRA_ADMIN_URL', 'HYDRA_PUBLIC_URL', 'OUTLINE_OIDC_CLIENT_SECRET'] }
    if (error?.message === 'Hydra client initialization failed (HTTP 404)') throw new RuntimeError('HYDRA_CLIENT_MISSING', context)
    if (error?.message === 'Invalid Hydra bootstrap configuration') throw new RuntimeError('HYDRA_CONFIG_INVALID', context)
    if (/^Existing Hydra client (configuration conflict; explicit operator repair is required|secret conflict or protocol service unavailable)$/.test(error?.message ?? ''))
      throw new RuntimeError('HYDRA_CLIENT_CONFLICT', context)
    if (error?.code || error?.cause?.code) throw diagnostic(error, { ...context, next: '核对 Hydra admin/public 地址；本地检查 pnpm service:status 和 pnpm service:logs hydra' })
    throw new RuntimeError('HYDRA_CLIENT_CHECK_FAILED', context)
  }
}

/** All preparation checks are read-only; database markers replace configurable hash receipts. */
export async function verifyApplications(state, { execute = runOwned, tools = toolchain({ workspace: state.workspace, inherited: state.values }),
  verifySchemas = verifyFoundationSchemas, verifyClient = verifyHydraClient, onLog = () => {}, signal } = {}) {
  await verifySchemas(state, { bootstrap: true })
  await execute(cliSpecification(state, tools, 'server', 'integration:check'), { onLog, signal, code: 'WEBSITE_NOT_READY', next: '按上方 Website 检查失败项修正；只有表结构或 migration 缺失时才执行 pnpm db:migrate' })
  await execute(cliSpecification(state, tools, 'outline', 'integration-check'), { onLog, signal, code: 'OUTLINE_NOT_READY', next: '按上方 Outline 检查失败项修正；身份准备须选择已有 active 用户 UUID' })
  await verifyRuntimeHydraClient(state, verifyClient)
}

/** Watch processes own only their child generation. Dependency services are never stopped here. */
export async function runDevelopment(state, { service, verbose = false } = {}) {
  if (state.profile !== 'local') throw new RuntimeError('LOCAL_PROFILE_REQUIRED')
  const tools = toolchain({ workspace: state.workspace, inherited: state.values })
  const lock = acquireApplicationLock(state)
  const scope = signalScope()
  const logFile = join(state.directory, `applications-${lock.record.runId}.log`)
  const output = reporter({ environment: state.values, verbose, persist: line => appendFileSync(logFile, `${line}\n`) })
  const onLog = output.log
  let handedOff = false
  try {
    output.heading('ExWebsite · 开发监听')
    output.note('正在检查 Website 与 Outline 的启动条件…')
    await verifyApplications(state, { tools, onLog, signal: scope.signal })
    for (const port of [state.config.ports.public, state.config.ports.web, state.config.ports.api, state.config.ports.outline, state.config.ports.outlineVite]) await assertPortFree(port)
    scope.check(); scope.close(); handedOff = true
    await supervise({ mode: 'local', fingerprint: state.fingerprint, directory: state.directory, controlDirectory: state.directory,
      lock, specifications: specifications(state, tools).filter(spec => !service || spec.name === service), onLog,
      onReady: () => {
        output.success('开发服务已就绪')
        output.status('Website', '可访问', `${state.config.publicOrigin}/`, { level: 'success' })
        output.status('Outline', '可访问', `${state.config.publicOrigin}/docs/`, { level: 'success' })
        output.note('LOCAL_READY · Ctrl+C 结束应用')
      },
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
