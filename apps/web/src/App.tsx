import { Route, Routes } from 'react-router'
import { Home } from '@web/src/pages/Home'
import { NotFound } from '@web/src/pages/NotFound'
import { AuthPage } from '@web/src/pages/AuthPage'
import { SsoSuccess } from '@web/src/pages/AuthPage/SsoSuccess'
import { RootLayout } from '@web/src/routes/RootLayout'
import { ProfilePage } from '@web/src/pages/ProfilePage'
import { AuthProvider } from '@web/src/auth/AuthContext'
import { InvitationRegistrationPage } from '@web/src/pages/AuthPage/InvitationRegistrationPage'
import { JoinPage } from '@web/src/pages/JoinPage/Rifling-911'
import { CAEPJoinPage } from '@web/src/pages/JoinPage/CAEP'
import { JoinResultPage } from '@web/src/pages/JoinResultPage'
import { JoinReviewPage } from '@web/src/pages/JoinReviewPage'

/**
 * 路由表：认证和 SSO 页面使用独立布局，其余页面共用站点顶栏。
 * 首版不含业务页面，因此这就是全部路由；`<BrowserRouter>` 由 `main.tsx` 提供。
 */
export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<InvitationRegistrationPage />} />
        <Route path="/sso/success" element={<SsoSuccess />} />
        <Route path="/sso/*" element={<NotFound />} />
        <Route element={<RootLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/communities/rifling-911" element={<JoinPage />} />
          <Route path="/communities/caep" element={<CAEPJoinPage />} />
          <Route path="/join/rifling-911" element={<JoinPage />} />
          <Route path="/join/result" element={<JoinResultPage />} />
          <Route path="/admin/join-applications" element={<JoinReviewPage />} />
          <Route path="/account/profile" element={<ProfilePage />} />
        </Route>
        <Route element={<RootLayout glassAtTop />}>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
