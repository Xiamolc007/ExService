import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { ThemeProvider, GlassSeed } from '@exre/exui'
import { api } from './api/client'
import { App } from './App'
import { SettingsThemeProjection } from './settings/SettingsThemeProjection'
// ExUI 的组件样式表，已内含 Token CSS 与字体 CSS，每个应用只导入这一次。
// 它必须排在 `./styles/index.scss` 之前：应用自己的样式要能覆盖库的默认值。
import '@exre/exui/style.css'
import './styles/index.scss'

const container = document.getElementById('root')

if (!container) {
  throw new Error('index.html is missing the #root container.')
}

/**
 * `<BrowserRouter>` 只在挂载点提供一次；`App` 只声明路由表。
 * 使用 history 路由意味着未来的 PHP 部署必须把未知路径回落到 `index.html`，
 * 否则深链接会由服务端直接 404。
 *
 * `<ThemeProvider>` 挂在路由之上，因此所有页面（含兜底页）都能使用 `useTheme`。
 * ExUI 的 provider 在渲染期读取 `localStorage`，只能在浏览器挂载；本应用是纯客户端
 * SPA，不存在服务端渲染路径，所以这里安全。
 *
 * `<GlassSeed />` 每个 document 只挂一个：它声明玻璃材质共用的 SVG 折射滤镜，不渲染
 * 子节点、不占布局、也不是 provider。缺了它材质照常工作，只是没有折射。它渲染静态
 * 标记，服务端渲染安全；折射增强在浏览器确认接受该滤镜链之后由 ref 回调打开。
 */
createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <SettingsThemeProjection />
      <GlassSeed />
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
)

/**
 * 开发期连通性检查：经共享 Client 调用 Contract 中的 `GET /health`
 * （base URL 为 `/api`，因此实际请求 `/api/health`）。
 *
 * 失败只输出明确的开发错误，不渲染健康检查面板或任何业务 UI。
 */
async function checkMockServer(): Promise<void> {
  try {
    const { error } = await api.GET('/health')

    if (error) {
      console.error('[dev] GET /api/health returned an error response from the Mock Server.', error)
      return
    }

    console.info('[dev] GET /api/health reached the Mock Server.')
  } catch (cause) {
    console.error(
      '[dev] GET /api/health could not reach the Mock Server on 127.0.0.1:8080. Start it with `pnpm dev`.',
      cause,
    )
  }
}

if (import.meta.env.DEV) {
  void checkMockServer()
}
