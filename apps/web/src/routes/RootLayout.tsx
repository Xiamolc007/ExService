import { useEffect, useRef, useState } from 'react'
import { Outlet, useNavigate } from 'react-router'
import { AuthModal, SiteHeader } from '@workspace/components'
import type { SettingsCategory } from '@workspace/components'
import { AuthFlow } from '../auth/AuthFlow'
import { useAuth } from '../auth/AuthContext'
import { SettingsModal } from '../settings/SettingsExperience'
import { InvitationRegistrationFlow } from '../invitations/InvitationRegistrationFlow'

/**
 * 站点布局层：提供站点顶栏与嵌套路由的挂载点。
 *
 * 登录与注册独立页不经过此布局；其余页面（含 `*`）共用导航。
 */
export function RootLayout() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [loginEmail, setLoginEmail] = useState('')
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory | null>(null)
  const menuButton = useRef<HTMLSpanElement>(null)
  const mobileMenuButton = useRef<HTMLSpanElement>(null)
  const registerButton = useRef<HTMLButtonElement>(null)
  const loginButton = useRef<HTMLButtonElement>(null)
  const authTrigger = useRef<'login' | 'register'>('login')
  const join = () => { auth.closeModal(); navigate('/join') }
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
        onLogin: () => { authTrigger.current = 'login'; setLoginEmail(''); auth.openModal('login') },
        onRegister: () => { authTrigger.current = 'register'; setLoginEmail(''); auth.openModal('register') },
        onRetry: auth.retrySession,
        onLogout: auth.logout,
        onProfile: () => setSettingsCategory('profile'),
        onSettings: () => setSettingsCategory('general'),
        menuButtonRef: menuButton,
        registerButtonRef: registerButton,
        loginButtonRef: loginButton,
      }} />
      <Outlet />
      {settingsCategory !== null && auth.state.status !== 'anonymous' &&
        <SettingsModal key={settingsCategory} initialCategory={settingsCategory}
          onClose={closeSettings} />}
      {auth.modalMode !== null && (
        <AuthModal
          open
          mode={auth.modalMode}
          onCloseAutoFocus={event => {
            event.preventDefault()
            if (window.matchMedia('(max-width: 52rem)').matches) mobileMenuButton.current?.querySelector('button')?.focus()
            else (authTrigger.current === 'register' ? registerButton.current : loginButton.current)?.focus()
          }}
          onOpenChange={(open) => {
            if (!open) auth.closeModal()
          }}
        >
          {auth.modalMode === 'register' ? <InvitationRegistrationFlow presentation="modal"
            onJoin={join} onLogin={email => { setLoginEmail(email); auth.openModal('login') }} /> : <AuthFlow
            initialMode="login"
            initialEmail={loginEmail}
            presentation="modal"
            onJoin={join}
            onFinished={auth.closeModal}
          />}
        </AuthModal>
      )}
    </>
  )
}
