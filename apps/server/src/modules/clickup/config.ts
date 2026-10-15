export type ClickUpConfig =
  | { kind: 'enabled'; token: string }
  | { kind: 'disabled' }
  | { kind: 'invalid'; reason: 'configuration_invalid' }

export function readClickUpConfig(env: NodeJS.ProcessEnv): ClickUpConfig {
  const token = env.CLICKUP_TOKEN
  if (token === undefined || token === '') return { kind: 'disabled' }
  // Header-safe opaque credential; no token value is included in diagnostics.
  if (token.length > 4096 || !/^[\x21-\x7e]+$/.test(token)) {
    return { kind: 'invalid', reason: 'configuration_invalid' }
  }
  return { kind: 'enabled', token }
}
