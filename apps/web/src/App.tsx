import { Route, Routes } from 'react-router'
import { Home } from './pages/Home'
import { NotFound } from './pages/NotFound'
import { AuthPage } from './pages/AuthPage'
import { SsoSuccess } from './pages/AuthPage/SsoSuccess'
import { RootLayout } from './routes/RootLayout'
import { ProfilePage } from './pages/ProfilePage'
import { AuthProvider } from './auth/AuthContext'
import { InvitationRegistrationPage } from './pages/AuthPage/InvitationRegistrationPage'
import { JoinPage } from './pages/JoinPage'
import { JoinResultPage } from './pages/JoinResultPage'
import { JoinReviewPage } from './pages/JoinReviewPage'

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
          <Route path="/join" element={<JoinPage />} />
          <Route path="/join/result" element={<JoinResultPage />} />
          <Route path="/admin/join-applications" element={<JoinReviewPage />} />
          <Route path="/account/profile" element={<ProfilePage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
