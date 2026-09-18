import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { api } from './api/client'
import { App } from './App'
import './styles/index.scss'

const container = document.getElementById('root')

if (!container) {
  throw new Error('index.html is missing the #root container.')
}

/**
 * `<BrowserRouter>` 只在挂载点提供一次；`App` 只声明路由表。
 * 使用 history 路由意味着未来的 PHP 部署必须把未知路径回落到 `index.html`，
 * 否则深链接会由服务端直接 404。
 */
createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
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
