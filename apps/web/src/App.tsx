import { Route, Routes } from 'react-router'
import { Home } from './pages/Home'
import { NotFound } from './pages/NotFound'
import { RootLayout } from './routes/RootLayout'

/**
 * 路由表：唯一的根布局挂载首页与兜底页。
 * 首版不含业务页面，因此这就是全部路由；`<BrowserRouter>` 由 `main.tsx` 提供。
 */
export function App() {
  return (
    <Routes>
      <Route element={<RootLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
