import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { deploymentBinding } from '../../scripts/runtime/deployment.mjs'
import { verifyNativeHealth } from '../../scripts/runtime/native.mjs'

const probes = vi.hoisted(() => ({
  ready: vi.fn(async (_url: URL, _options: { timeout: number }) => {}),
  execute: vi.fn(async (_spec: { name: string, args: string[] }) => {}),
  client: vi.fn(async (_options: Record<string, unknown>) => {}),
  databases: [] as string[],
}))

vi.mock('../../scripts/docs-integration/local-dev.mjs', async importOriginal => ({
  ...await importOriginal<object>(), httpReady: probes.ready,
}))
vi.mock('../../scripts/docs-integration/ownership.mjs', async importOriginal => ({
  ...await importOriginal<object>(), runOwned: probes.execute,
}))
vi.mock('../../scripts/docs-integration/local-config.mjs', async importOriginal => ({
  ...await importOriginal<object>(), toolchain: () => ({ node: process.execPath }),
}))
vi.mock('../../scripts/docs-integration/hydra-client.mjs', async importOriginal => ({
  ...await importOriginal<object>(), verifyHydraClient: probes.client,
}))
vi.mock('pg', () => ({ default: { Client: class {
  name: string
  constructor({ connectionString }: { connectionString: string }) {
    this.name = new URL(connectionString).pathname.slice(1)
  }
  async connect() { probes.databases.push(this.name) }
  async query(sql: string) {
    return { rows: sql.includes('current_database') ? [{ name: this.name }]
      : sql.includes('to_regclass') ? [{ name: 'website_integrations' }]
      : sql.includes('SELECT issuer') ? [{ issuer: 'https://issuer.example/' }] : [] }
  }
  async end() {}
} } }))

const workspaces: string[] = []
afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true })
  vi.clearAllMocks()
  probes.databases.length = 0
})

test('native health runs deployment client validation and both integration checks with healthy dependencies', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'exwebsite-native-health-'))
  workspaces.push(workspace)
  const state = {
    workspace, profile: 'deployment',
    config: { websiteTarget: { database: 'exre' }, publicOrigin: 'https://site.example',
      issuer: 'https://issuer.example/', callback: 'https://site.example/docs/auth/oidc.callback', clientId: 'ex-outline' },
    internal: { website: 'http://127.0.0.1:8082/', outline: 'http://127.0.0.1:3102/', hydra: 'http://127.0.0.1:4445/' },
    values: { HYDRA_ADMIN_URL: 'http://127.0.0.1:4445/', OUTLINE_OIDC_CLIENT_SECRET: 'test-client' },
    secrets: { OUTLINE_OIDC_CLIENT_SECRET: 'test-client', IDENTITY_DELIVERY_KEY: 'test-delivery' },
    databases: { DATABASE: 'postgres://test:test@127.0.0.1:1/exre', OUTLINE_DATABASE: 'postgres://test:test@127.0.0.1:1/outline' },
    environments: { server: {}, outline: {} },
  }
  const directory = join(workspace, '.local/runtime-deployment')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'identity.json'), JSON.stringify(deploymentBinding(state)))

  await verifyNativeHealth(state)

  expect(probes.ready.mock.calls.map(([url]) => String(url))).toEqual([
    'http://127.0.0.1:8082/api/health', 'http://127.0.0.1:3102/_health', 'http://127.0.0.1:4445/health/ready',
  ])
  expect(probes.databases).toEqual(['exre', 'outline'])
  expect(probes.client).toHaveBeenCalledTimes(2)
  for (const [options] of probes.client.mock.calls) expect(options).toMatchObject({
    mode: 'deployment', adminUrl: state.internal.hydra, publicUrl: state.config.issuer,
    publicOrigin: state.config.publicOrigin, callback: state.config.callback, clientId: 'ex-outline',
    clientSecret: state.values.OUTLINE_OIDC_CLIENT_SECRET,
  })
  expect(probes.execute.mock.calls.map(([spec]) => ({ name: spec.name, args: spec.args }))).toEqual([
    { name: 'server', args: [join(workspace, 'scripts/runtime/server.mjs'), 'integration:check'] },
    { name: 'outline', args: [join(workspace, 'apps/outline/build/server/scripts/integration-check.js')] },
  ])
})
