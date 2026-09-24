import type { components } from '@workspace/api-client'
import { proxy } from 'valtio'
import type { SettingsTheme } from '@workspace/components'

export type CurrentUser = components['schemas']['CurrentUser']

export const settingsConfig = proxy({
  general: { theme: 'system' as SettingsTheme },
  profile: {
    snapshot: null as CurrentUser | null,
    status: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
    error: null as string | null,
  },
})

let ownerToken: string | null = null
let revision = 0
let writing = false
let consumers = 0

export function bindSettingsToken(token: string | null) {
  if (ownerToken === token) return
  ownerToken = token
  revision += 1
  writing = false
  settingsConfig.profile.snapshot = null
  settingsConfig.profile.status = 'idle'
  settingsConfig.profile.error = null
}

export function beginSettingsRequest(token: string) {
  bindSettingsToken(token)
  if (writing) return null
  return ++revision
}

export function settingsRequestCurrent(token: string, requestRevision: number) {
  return ownerToken === token && revision === requestRevision
}

export function attachSettingsConsumer() {
  consumers += 1
  return () => {
    consumers -= 1
    if (consumers === 0 && !writing) {
      revision += 1
      if (settingsConfig.profile.status === 'loading') settingsConfig.profile.status = 'idle'
    }
  }
}

export function beginSettingsWrite(token: string) {
  bindSettingsToken(token)
  if (writing) throw new Error('请等待当前操作完成')
  writing = true
  return ++revision
}

export function endSettingsWrite(token: string, requestRevision: number) {
  if (ownerToken === token && revision === requestRevision) writing = false
}
