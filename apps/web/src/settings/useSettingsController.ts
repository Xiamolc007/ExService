import { useCallback, useEffect, useState } from 'react'
import { useTheme } from '@exre/exui'
import type { components } from '@workspace/api-client'
import type { SettingsField, SettingsTheme } from '@workspace/components'
import { useSnapshot } from 'valtio'
import { api } from '@web/src/api/client'
import { useAuth } from '@web/src/auth/AuthContext'
import { AUTH_TOKEN_KEY, readToken } from '@web/src/auth/storage'
import {
  attachSettingsConsumer, beginSettingsRequest, beginSettingsWrite, bindSettingsToken,
  endSettingsWrite, settingsConfig, settingsRequestCurrent, type CurrentUser,
} from '@web/src/settings/settingsConfig'

type AvatarMediaType = components['schemas']['UploadAvatarRequest']['mediaType']

export function useSettingsController() {
  const auth = useAuth()
  const { setTheme } = useTheme()
  const snapshot = useSnapshot(settingsConfig)
  const [actionPending, setActionPending] = useState(false)
  const [logoutPending, setLogoutPending] = useState(false)

  useEffect(() => {
    const sync = () => {
      try { bindSettingsToken(readToken(window.localStorage)) }
      catch { bindSettingsToken(null) }
    }
    sync()
    const onStorage = (event: StorageEvent) => { if (event.key === AUTH_TOKEN_KEY) sync() }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  useEffect(() => {
    if (auth.state.status === 'anonymous') bindSettingsToken(null)
    if (auth.state.status === 'unavailable') setLogoutPending(false)
  }, [auth.state.status])
  useEffect(() => attachSettingsConsumer(), [])

  const invalidate = auth.invalidateSession
  const load = useCallback(async () => {
    let token: string
    try { token = requireToken() }
    catch { settingsConfig.profile.status = 'error'; settingsConfig.profile.error = '请重新登录'; return }
    const revision = beginSettingsRequest(token)
    if (revision === null) return
    settingsConfig.profile.status = 'loading'
    settingsConfig.profile.error = null
    try {
      const result = await api.GET('/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      if (!current(token, revision)) return
      if (result.error !== undefined) {
        if (result.error.error.code === 'SESSION_INVALID') { invalidate(token); bindSettingsToken(null); return }
        settingsConfig.profile.status = 'error'
        settingsConfig.profile.error = result.error.error.message
        return
      }
      settingsConfig.profile.snapshot = result.data
      settingsConfig.profile.status = 'ready'
    } catch {
      if (current(token, revision)) {
        settingsConfig.profile.status = 'error'
        settingsConfig.profile.error = '暂时无法读取设置资料'
      }
    }
  }, [invalidate])

  const mutate = useCallback(async (request: (token: string) => Promise<{
    data?: CurrentUser; error?: { error: { code: string; message: string } }
  }>) => {
    if (auth.state.status !== 'authenticated') throw new Error('登录状态不可用，请重试')
    const token = requireToken()
    const revision = beginSettingsWrite(token)
    setActionPending(true)
    try {
      const result = await request(token)
      if (!current(token, revision)) throw new Error('登录状态已变更，请重新打开设置')
      if (result.error) {
        if (result.error.error.code === 'SESSION_INVALID') { auth.invalidateSession(token); bindSettingsToken(null) }
        throw new Error(result.error.error.message)
      }
      if (!result.data) throw new Error('服务器未返回更新后的资料')
      settingsConfig.profile.snapshot = result.data
      settingsConfig.profile.status = 'ready'
      try { await auth.refreshProfile() }
      catch { /* AuthContext manages its own unavailable state. The saved snapshot remains valid. */ }
    } catch (error) {
      if (error instanceof Error) throw error
      throw new Error('保存失败，请稍后重试')
    } finally { endSettingsWrite(token, revision); setActionPending(false) }
  }, [auth])

  const save = useCallback(async (field: SettingsField, value: string) => {
    const body = field === 'nickname' ? { nickname: value } : field === 'qq' ?
      { qq: value === '' ? null : value } : { fivemId: value === '' ? null : value }
    await mutate((token) => api.PATCH('/auth/me', {
      headers: { Authorization: `Bearer ${token}` }, body,
    }))
  }, [mutate])

  const upload = useCallback(async (file: Blob) => {
    const mediaType = file.type as AvatarMediaType
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mediaType) || file.size > 2 * 1024 * 1024) {
      throw new Error('只支持不超过 2 MiB 的 PNG、JPEG 或 WebP 图片')
    }
    const imageBase64 = await toBase64(file)
    await mutate((token) => api.POST('/auth/me/avatar', {
      headers: { Authorization: `Bearer ${token}` }, body: { imageBase64, mediaType },
    }))
  }, [mutate])

  const removeAvatar = useCallback(async () => {
    const body: components['schemas']['UpdateCurrentUserRequest'] = { avatar: null }
    await mutate((token) => api.PATCH('/auth/me', {
      headers: { Authorization: `Bearer ${token}` }, body: body as never,
    }))
  }, [mutate])

  const logout = useCallback(() => {
    if (logoutPending) return
    setLogoutPending(true)
    auth.logout()
  }, [logoutPending, auth])

  return {
    snapshot, load, save, upload, removeAvatar, logout,
    actionPending, logoutPending,
    authMessage: auth.state.status === 'unavailable' ? auth.state.message : undefined,
    retryAuth: auth.retrySession,
    setTheme: (next: SettingsTheme) => setTheme(next),
  }
}

function requireToken() {
  const token = readToken(window.localStorage)
  if (token === null) throw new Error('登录已失效，请重新登录')
  return token
}

function current(token: string, revision: number) {
  try { return readToken(window.localStorage) === token && settingsRequestCurrent(token, revision) }
  catch { return false }
}

async function toBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  }
  return btoa(binary)
}
