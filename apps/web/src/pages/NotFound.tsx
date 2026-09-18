/**
 * 未匹配路径的兜底页面：纯静态文案。
 * 它不能替代 Mock Server 的 404 envelope —— 这里只处理前端路由，不发起任何 API 请求。
 */
export function NotFound() {
  return (
    <main className="app-shell">
      <h1>Page not found</h1>
      <p>No route matches this path.</p>
    </main>
  )
}
