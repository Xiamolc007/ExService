import { useCallback, useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { api } from '@web/src/api/client'
import { useAuth } from '@web/src/auth/AuthContext'
import { readToken, subscribeSessionChanges } from '@web/src/auth/storage'
import { ExAxiosError } from '@workspace/sdk/http/browser'
import {
  bindNotificationsToken, captureNotificationRead, captureNotificationWrite,
  isCurrentNotificationGeneration, notificationsConfig,
} from '@web/src/notifications/notificationsConfig'
import type { NotificationPreferencesDraft, SettingsNotificationsSlice } from '@workspace/components'

/**
 * 通知偏好控制器：与资料切片完全独立的一路读写。
 *
 * - 读取失败只影响通知分区，不改资料/主题门控；
 * - 保存是**整份可选类别的替换**，带 `expectedRevision`；409 时保留草稿，
 *   只更新服务器快照与 revision 供用户对照，绝不盲 PUT 覆盖；
 * - 换号/退出/明确会话失效清空快照与草稿：快照由 `bindNotificationsToken` 直接清，
 *   草稿是 React Hook Form 的内部状态，靠 `identityEpoch` 让表单自己丢弃。
 */
export function useNotificationPreferencesController() {
  const auth = useAuth()
  const snapshot = useSnapshot(notificationsConfig)
  const authenticated = auth.state.status === 'authenticated'
  const invalidate = auth.invalidateSession

  useEffect(() => {
    const sync = () => {
      try { bindNotificationsToken(readToken(window.localStorage)) }
      catch { bindNotificationsToken(null) }
    }
    sync()
    return subscribeSessionChanges(sync)
  }, [])

  const load = useCallback(async () => {
    if (!authenticated) return
    const generation = captureNotificationRead()
    notificationsConfig.preferences.status = 'loading'
    notificationsConfig.preferences.error = null
    try {
      const result = await api.GET('/notification-preferences', { alert: false })
      if (!isCurrentNotificationGeneration(generation)) return
      notificationsConfig.preferences.snapshot = result
      notificationsConfig.preferences.status = 'ready'
    } catch (error) {
      if (!isCurrentNotificationGeneration(generation)) return
      if (error instanceof ExAxiosError && error.code === 'SESSION_INVALID') {
        const token = currentToken()
        if (token !== null) invalidate(token)
        bindNotificationsToken(null)
        return
      }
      notificationsConfig.preferences.status = 'error'
      notificationsConfig.preferences.error = error instanceof ExAxiosError
        ? error.message : '通知设置暂时无法读取'
    }
  }, [authenticated, invalidate])

  const save = useCallback(async (draft: NotificationPreferencesDraft) => {
    const stored = notificationsConfig.preferences.snapshot
    if (stored === null) throw new Error('通知设置尚未读取成功，请稍后重试')
    const generation = captureNotificationWrite()
    notificationsConfig.preferences.saving = true
    notificationsConfig.preferences.message = null
    notificationsConfig.preferences.conflict = false
    try {
      const result = await api.PUT('/notification-preferences', {
        alert: false,
        body: { expectedRevision: stored.revision, optionalCategories: draft },
      })
      if (!isCurrentNotificationGeneration(generation)) return
      notificationsConfig.preferences.snapshot = result
      notificationsConfig.preferences.message = '通知设置已保存。'
    } catch (error) {
      if (!isCurrentNotificationGeneration(generation)) return
      if (error instanceof ExAxiosError && error.code === 'SESSION_INVALID') {
        const token = currentToken()
        if (token !== null) invalidate(token)
        bindNotificationsToken(null)
        throw new Error('登录状态已失效，请重新登录')
      }
      if (error instanceof ExAxiosError && error.status === 409) {
        // 草稿保留：只把服务器最新版本取回来给用户对照。
        notificationsConfig.preferences.conflict = true
        notificationsConfig.preferences.message = '设置已被其他设备修改（409），草稿已保留。请核对最新版本。'
        void load()
        throw new Error('设置已被其他设备修改（409），草稿已保留。请核对最新版本。')
      }
      throw new Error(error instanceof ExAxiosError ? error.message : '保存失败，草稿已保留。请重试。')
    } finally {
      notificationsConfig.preferences.saving = false
    }
  }, [invalidate, load])

  /** 409 之后的显式重读：只更新服务器快照，不动草稿。 */
  const refresh = useCallback(async () => {
    await load()
    notificationsConfig.preferences.conflict = false
    notificationsConfig.preferences.message = '已核对最新版本，草稿仍保留。请决定是否保存。'
  }, [load])

  const slice: SettingsNotificationsSlice = {
    // 草稿的归属跟着身份代次走：换号/退出时表单必须丢弃上一个身份的草稿。
    identityEpoch: snapshot.epoch,
    preferences: snapshot.preferences.snapshot === null ? null : {
      announcement: snapshot.preferences.snapshot.optionalCategories.announcement,
      personal_update: snapshot.preferences.snapshot.optionalCategories.personal_update,
    },
    status: snapshot.preferences.status,
    onRetry: () => void load(),
    saving: snapshot.preferences.saving,
    message: snapshot.preferences.message,
    conflict: snapshot.preferences.conflict,
    necessaryCategories: [...(snapshot.preferences.snapshot?.necessaryCategories ?? [])],
    onSave: save,
    onRefresh: () => void refresh(),
  }

  return { slice, load, save, refresh, snapshot }
}

function currentToken(): string | null {
  try { return readToken(window.localStorage) }
  catch { return null }
}
