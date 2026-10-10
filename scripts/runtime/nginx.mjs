import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { RuntimeError } from './output.mjs'

/** Renders validated deployment addresses. Installation/reload remain explicit operator actions. */
export function nginxConfiguration(state) {
  if (state.profile !== 'deployment') throw new RuntimeError('DEPLOYMENT_PROFILE_REQUIRED')
  const origin = new URL(state.config.publicOrigin), issuer = new URL(state.config.issuer)
  if (origin.hostname === issuer.hostname || origin.port || issuer.port) throw new RuntimeError('NGINX_DISTINCT_HTTPS_HOSTS_REQUIRED')
  const values = {
    SITE_HOST: origin.hostname, ISSUER_HOST: issuer.hostname, SITE_ROOT: join(state.workspace, 'apps/web/dist').replaceAll('\\', '/'),
    API_UPSTREAM: state.internal.website.replace(/\/$/, ''), OUTLINE_UPSTREAM: state.internal.outline,
    HYDRA_UPSTREAM: state.values.HYDRA_INTERNAL_PUBLIC_URL?.replace(/\/$/, ''),
    SITE_CERT: state.values.NGINX_SITE_CERT, SITE_KEY: state.values.NGINX_SITE_KEY,
    ISSUER_CERT: state.values.NGINX_ISSUER_CERT, ISSUER_KEY: state.values.NGINX_ISSUER_KEY,
  }
  for (const [key, value] of Object.entries(values)) {
    if (!value || /[\s;{}$'"\\]/.test(value)) throw new RuntimeError('NGINX_VALUE_INVALID', { keys: [key] })
    if (key.endsWith('UPSTREAM')) {
      let url
      try { url = new URL(value) } catch { throw new RuntimeError('NGINX_UPSTREAM_INVALID', { keys: [key] }) }
      if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')
        throw new RuntimeError('NGINX_UPSTREAM_INVALID', { keys: [key] })
    }
  }
  return readFileSync(join(state.workspace, 'infra/runtime/nginx.conf.template'), 'utf8')
    .replace(/@@([A-Z_]+)@@/g, (_, key) => values[key])
}
export function renderNginx(state) {
  const content = nginxConfiguration(state), directory = join(state.directory, 'nginx')
  mkdirSync(directory, { recursive: true })
  const file = join(directory, 'nginx.conf')
  writeFileSync(file, content, { mode: 0o600 })
  return file
}
