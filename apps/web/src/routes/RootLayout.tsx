import { useEffect, useRef, useState } from 'react'
import { Outlet } from 'react-router'
import { AuthModal, SiteHeader } from '@workspace/components'
import type { SettingsCategory } from '@workspace/components'
import { AuthFlow } from '../auth/AuthFlow'
import { useAuth } from '../auth/AuthContext'
import { SettingsModal } from '../settings/SettingsExperience'

/**
 * 站点布局层：提供站点顶栏与嵌套路由的挂载点。
 *
 * 登录与注册独立页不经过此布局；其余页面（含 `*`）共用导航。
 */
export function RootLayout() {
  const auth = useAuth()
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory | null>(null)
  const menuButton = useRef<HTMLSpanElement>(null)
  const mobileMenuButton = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (auth.state.status === 'anonymous') setSettingsCategory(null)
  }, [auth.state.status])
  const closeSettings = () => {
    setSettingsCategory(null)
    requestAnimationFrame(() => {
      const isMobile = window.matchMedia('(max-width: 52rem)').matches
      const target = isMobile ? mobileMenuButton.current : menuButton.current
      target?.querySelector('button')?.focus()
    })
  }

  return (
    <>
      <SiteHeader mobileMenuButtonRef={mobileMenuButton} auth={{
        state: auth.state,
        onLogin: () => auth.openModal('login'),
        onRegister: () => auth.openModal('register'),
        onRetry: auth.retrySession,
        onLogout: auth.logout,
        onProfile: () => setSettingsCategory('profile'),
        onSettings: () => setSettingsCategory('general'),
        menuButtonRef: menuButton,
      }} />
      <Outlet />
      {settingsCategory !== null && auth.state.status !== 'anonymous' &&
        <SettingsModal key={settingsCategory} initialCategory={settingsCategory}
          onClose={closeSettings} />}
      {auth.modalMode !== null && (
        <AuthModal
          open
          mode={auth.modalMode}
          onOpenChange={(open) => {
            if (!open) auth.closeModal()
          }}
        >
          <AuthFlow
            initialMode={auth.modalMode}
            presentation="modal"
            onModeChange={auth.openModal}
            onFinished={auth.closeModal}
          />
        </AuthModal>
      )}
    </>
  )
}
