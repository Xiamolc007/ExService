import { useCallback, useEffect, useRef } from 'react'
import { useSnapshot } from 'valtio'
import { api } from '@web/src/api/client'
import { useAuth } from '@web/src/auth/AuthContext'
import { readToken, subscribeSessionChanges } from '@web/src/auth/storage'
import { ExAxiosError } from '@workspace/sdk/http/browser'
import { bindNotificationsToken, notificationsConfig } from '@web/src/notifications/notificationsConfig'
import type { NotificationPreferencesDraft, SettingsNotificationsSlice } from '@workspace/components'

interface SaveRun { epoch: number; owner: symbol }
// Settings page and header Modal can mount separate owners of the same proxy.
// Preferences have their own revision: receipt writes must not invalidate them.
const runtime = { epoch: -1, readId: 0, readOwner: null as symbol | null, writeVersion: 0, save: null as SaveRun | null }
function syncRuntime() {
  if (runtime.epoch === notificationsConfig.epoch) return
  runtime.epoch = notificationsConfig.epoch; runtime.readId += 1; runtime.readOwner = null; runtime.writeVersion += 1; runtime.save = null
}
function discardOwnedReads() {
  runtime.readId += 1; runtime.readOwner = null
  if (notificationsConfig.preferences.status !== 'loading') return
  notificationsConfig.preferences.status = notificationsConfig.preferences.snapshot === null ? 'error' : 'ready'
  notificationsConfig.preferences.error = notificationsConfig.preferences.snapshot === null ? '通知设置暂时无法读取' : null
}

/** 偏好即时保存；共享请求归属保护多设置宿主，成功采用服务端值且不显示成功提示。 */
export function useNotificationPreferencesController() {
  const auth = useAuth()
  const snapshot = useSnapshot(notificationsConfig)
  const authenticated = auth.state.status === 'authenticated'
  const mounted = useRef(true)
  const owner = useRef(Symbol('notification-preferences'))
  useEffect(() => {
    const sync = () => { bindNotificationsToken(currentToken()); syncRuntime() }
    sync()
    return subscribeSessionChanges(sync)
  }, [])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // An already-sent PUT belongs to the shared identity until it settles.
      // Exiting its Form cannot cancel the server write or release its HTTP lock.
      if (runtime.readOwner === owner.current && runtime.epoch === notificationsConfig.epoch) {
        discardOwnedReads()
      }
    }
  }, [])
  const sessionInvalid = useCallback((error: unknown) => {
    if (!(error instanceof ExAxiosError) || error.code !== 'SESSION_INVALID') return false
    const token = currentToken()
    if (token !== null) auth.invalidateSession(token)
    bindNotificationsToken(null); syncRuntime()
    return true
  }, [auth.invalidateSession])

  const load = useCallback(async (sharedSettlement = false): Promise<void> => {
    if (!authenticated || currentToken() === null || (!mounted.current && !sharedSettlement)) return
    syncRuntime()
    const epoch = runtime.epoch, requestId = ++runtime.readId, version = runtime.writeVersion
    runtime.readOwner = sharedSettlement ? null : owner.current
    const accepted = () => (mounted.current || sharedSettlement) && notificationsConfig.epoch === epoch
      && runtime.readId === requestId && runtime.writeVersion === version
    notificationsConfig.preferences.status = 'loading'; notificationsConfig.preferences.error = null
    try {
      const result = await api.GET('/notification-preferences', { alert: false })
      if (!accepted()) return
      notificationsConfig.preferences.snapshot = result; notificationsConfig.preferences.status = 'ready'
    } catch (error) {
      if (!accepted() || sessionInvalid(error)) return
      notificationsConfig.preferences.status = 'error'; notificationsConfig.preferences.error = '通知设置暂时无法读取'
    } finally {
      if (runtime.epoch === epoch && runtime.readId === requestId) runtime.readOwner = null
    }
  }, [authenticated, sessionInvalid])

  const save = useCallback(async (draft: NotificationPreferencesDraft): Promise<NotificationPreferencesDraft> => {
    if (!authenticated || currentToken() === null || !mounted.current) throw new Error('登录状态不可用，请重新登录。')
    syncRuntime()
    if (runtime.save !== null) throw new Error('正在保存，请稍候。')
    const stored = notificationsConfig.preferences.snapshot
    if (stored === null) throw new Error('通知设置尚未读取成功，请稍后重试。')
    const run = { epoch: runtime.epoch, owner: owner.current }
    runtime.save = run; runtime.writeVersion += 1; runtime.readId += 1
    const owned = () => notificationsConfig.epoch === run.epoch && runtime.save === run
    notificationsConfig.preferences.saving = true; notificationsConfig.preferences.message = null; notificationsConfig.preferences.conflict = false
    try {
      const result = await api.PUT('/notification-preferences', { alert: false,
        body: { expectedRevision: stored.revision, optionalCategories: draft } })
      if (!owned()) throw new Error('本次保存已失效。')
      runtime.writeVersion += 1; runtime.readId += 1
      notificationsConfig.preferences.snapshot = result; notificationsConfig.preferences.status = 'ready'
      notificationsConfig.preferences.error = null
      return { ...result.optionalCategories }
    } catch (error) {
      if (!owned()) throw new Error('本次保存已失效。')
      if (sessionInvalid(error)) throw new Error('登录状态已失效，请重新登录。')
      runtime.writeVersion += 1; runtime.readId += 1
      if (error instanceof ExAxiosError && error.status === 409) {
        notificationsConfig.preferences.conflict = true
        notificationsConfig.preferences.message = '设置已由其他设备更新，请重新调整。'
        await load(true)
        if (!owned()) throw new Error('本次保存已失效。')
        throw new Error('设置已由其他设备更新，请重新调整。')
      }
      notificationsConfig.preferences.status = 'ready'
      throw new Error('保存失败，已恢复上次设置。请重试。')
    } finally {
      if (runtime.save === run && notificationsConfig.epoch === run.epoch) {
        runtime.save = null; notificationsConfig.preferences.saving = false
      }
    }
  }, [authenticated, sessionInvalid, load])

  const refresh = useCallback(async () => {
    const epoch = notificationsConfig.epoch
    await load()
    if (mounted.current && notificationsConfig.epoch === epoch && notificationsConfig.preferences.status === 'ready') {
      notificationsConfig.preferences.conflict = false; notificationsConfig.preferences.message = null
    }
  }, [load])
  const slice: SettingsNotificationsSlice = {
    identityEpoch: snapshot.epoch,
    preferences: snapshot.preferences.snapshot === null ? null : { ...snapshot.preferences.snapshot.optionalCategories },
    status: snapshot.preferences.status, onRetry: () => void load(), saving: snapshot.preferences.saving,
    message: snapshot.preferences.message, conflict: snapshot.preferences.conflict,
    necessaryCategories: [...(snapshot.preferences.snapshot?.necessaryCategories ?? [])], onSave: save, onRefresh: () => void refresh(),
  }
  return { slice, load, save, refresh, snapshot }
}
function currentToken(): string | null { try { return readToken(window.localStorage) } catch { return null } }
