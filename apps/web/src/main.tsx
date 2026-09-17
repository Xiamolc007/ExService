import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { api } from './api/client'
import { App } from './App'
import './styles/index.scss'

const container = document.getElementById('root')

if (!container) {
  throw new Error('index.html is missing the #root container.')
}

createRoot(container).render(
  <StrictMode>
    <App />
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
      '[dev] GET /api/health could not reach the Mock Server on 127.0.0.1:3000. Start it with `pnpm dev`.',
      cause,
    )
  }
}

if (import.meta.env.DEV) {
  void checkMockServer()
}
