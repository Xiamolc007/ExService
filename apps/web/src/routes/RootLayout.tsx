import { Outlet } from 'react-router'
import { AuthModal, SiteHeader } from '@workspace/components'
import { AuthFlow } from '../auth/AuthFlow'
import { useAuth } from '../auth/AuthContext'

/**
 * 站点布局层：提供站点顶栏与嵌套路由的挂载点。
 *
 * 登录与注册独立页不经过此布局；其余页面（含 `*`）共用导航。
 */
export function RootLayout() {
  const auth = useAuth()

  return (
    <>
      <SiteHeader auth={{
        state: auth.state,
        onLogin: () => auth.openModal('login'),
        onRegister: () => auth.openModal('register'),
        onRetry: auth.retrySession,
        onLogout: auth.logout,
      }} />
      <Outlet />
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
