import { ensureHydraClient } from './hydra-client.mjs'
// The legacy issuer remains unchanged, while protocol calls use the isolated network.
try {
  const options = { adminUrl: 'http://hydra:4445/', publicUrl: 'http://identity.exwebsite.test:8090/', mode: 'full', tokenUrl: 'http://hydra:4444/',
    clientSecret: process.env.OUTLINE_OIDC_CLIENT_SECRET }
  await ensureHydraClient(options)
  await ensureHydraClient({ ...options, clientId: 'ex-oidc-probe', clientSecret: process.env.OIDC_PROBE_CLIENT_SECRET })
  console.log('LEGACY_HYDRA_CLIENTS_READY')
} catch { console.error('LEGACY_HYDRA_CLIENT_PREPARATION_FAILED'); process.exitCode = 1 }
