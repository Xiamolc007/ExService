import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@exre/exui'
import { SettingsPanel, type SettingsCategory } from '@workspace/components'
import { useAuth } from '../auth/AuthContext'
import { useSettingsController } from './useSettingsController'
import { settingsConfig } from './settingsConfig'
import styles from './SettingsExperience.module.scss'

export function SettingsExperience({ initialCategory }: { initialCategory: SettingsCategory }) {
  const [category, setCategory] = useState<SettingsCategory>(initialCategory)
  const settings = useSettingsController()
  const auth = useAuth()
  useEffect(() => {
    if (auth.state.status === 'authenticated' &&
      (settingsConfig.profile.snapshot !== null || settingsConfig.profile.status === 'error')) {
      void settings.load()
    }
  }, [auth.state.status, settings.load])
  useEffect(() => {
    if (category !== 'general' &&
      auth.state.status === 'authenticated' && settingsConfig.profile.status === 'idle') {
      void settings.load()
    }
  }, [category, auth.state.status, settings.load])

  const profile = settings.snapshot.profile.snapshot
  const authUnavailableWithoutProfile = auth.state.status === 'unavailable' && !profile
  return <SettingsPanel category={category} onCategoryChange={setCategory}
    theme={settings.snapshot.general.theme} onThemeChange={settings.setTheme}
    profile={profile ? {
      email: profile.email, nickname: profile.nickname, qq: profile.qq ?? null,
      fivemId: profile.fivemId ?? null, avatarUrl: profile.avatarUrl ?? null,
    } : null}
    profileStatus={authUnavailableWithoutProfile ? 'error' : settings.snapshot.profile.status}
    profileError={authUnavailableWithoutProfile ? settings.authMessage ?? '登录状态不可用' : settings.snapshot.profile.error}
    onRetry={authUnavailableWithoutProfile ? settings.retryAuth : () => void settings.load()}
    onSave={settings.save} onUpload={settings.upload}
    onRemoveAvatar={settings.removeAvatar} onLogout={settings.logout}
    logoutPending={settings.logoutPending} actionPending={settings.actionPending}
    authMessage={settings.authMessage} onRetryAuth={settings.retryAuth} />
}

export function SettingsModal({ initialCategory, onClose }: {
  initialCategory: SettingsCategory; onClose: () => void
}) {
  const auth = useAuth()
  useEffect(() => { if (auth.state.status === 'anonymous') onClose() }, [auth.state.status, onClose])
  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent className={styles.modal}>
      <DialogHeader className={styles.header}>
        <DialogTitle>设置</DialogTitle>
        <DialogDescription>管理外观、个人资料和账号。</DialogDescription>
      </DialogHeader>
      <SettingsExperience initialCategory={initialCategory} />
    </DialogContent>
  </Dialog>
}
